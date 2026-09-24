import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import {
  BleManager,
  State,
  type Device,
  type Subscription,
} from "react-native-ble-plx";
import {
  XIAO_BLE_CONFIG_CHARACTERISTIC_UUID,
  XIAO_BLE_DEVICE_NAME,
  XIAO_BLE_IMU_CHARACTERISTIC_UUID,
  XIAO_BLE_SERVICE_UUID,
  parseXiaoImuPacket,
  type XiaoImuPacket,
} from "@skate-route-mapper/shared/xiaoBle";
import {
  OP,
  RESEARCH_CONTROL_UUID,
  RESEARCH_RESPONSE_UUID,
  command,
  parseResponse,
  parseStatus,
  startArgument,
  type ResearchStatus,
} from "@skate-route-mapper/shared/xiaoResearch";

export type ResearchTransfer = {
  captureId: number;
  raw: Uint8Array;
  summaries: Uint8Array;
  rawReceived: number;
  summariesReceived: number;
  transferMs: number;
};

export type XiaoBleConnection = {
  deviceId: string;
  deviceName: string;
  disconnect: () => Promise<void>;
  setSampleInterval: (intervalMs: number) => Promise<void>;
  getResearchStatus: () => Promise<ResearchStatus>;
  startResearchCapture: (seconds: 10 | 30 | 60, rateHz: 833 | 1666) => Promise<ResearchStatus>;
  retrieveResearchCapture: (
    status: ResearchStatus,
    transfer: ResearchTransfer,
    onProgress?: (received: number, total: number) => void
  ) => Promise<ResearchTransfer>;
};

type ConnectOptions = {
  timeoutMs?: number;
  onSample?: (sample: XiaoImuPacket) => void;
};

let manager: BleManager | null = null;

function hasNativeBleModule() {
  return NativeModules.BlePlx != null;
}

function getManager() {
  if (!hasNativeBleModule()) {
    throw new Error(
      "XIAO BLE requires a development/native build with react-native-ble-plx included. Expo Go cannot connect to BLE sensors."
    );
  }

  if (!manager) {
    manager = new BleManager();
  }

  return manager;
}

export function isXiaoBleSupported() {
  return (Platform.OS === "android" || Platform.OS === "ios") && hasNativeBleModule();
}

export async function requestXiaoBlePermissions() {
  if (Platform.OS !== "android") {
    return true;
  }

  if (Number(Platform.Version) >= 31) {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);

    return (
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
        PermissionsAndroid.RESULTS.GRANTED &&
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
        PermissionsAndroid.RESULTS.GRANTED
    );
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * What a radio state that is not `PoweredOn` should tell the rider.
 *
 * These are the states that will not fix themselves, so each one ends the
 * attempt with something actionable rather than leaving it to time out.
 * `Unknown` and `Resetting` are deliberately absent: both are transient, so
 * they are waited out rather than reported. See `waitForPoweredOnAdapter`.
 */
const adapterStateMessages: Partial<Record<State, string>> = {
  [State.PoweredOff]: "Bluetooth is off. Turn it on and try again.",
  [State.Unauthorized]:
    "Skate Route Mapper is not allowed to use Bluetooth. Enable it in Settings.",
  [State.Unsupported]: "This device has no Bluetooth LE radio.",
};

/**
 * Wait for the radio before scanning.
 *
 * `new BleManager()` returns before the native adapter has reported anything,
 * so its state starts as `Unknown` and a scan started in that window is
 * rejected outright with "BluetoothLE is in unknown state". That is why the
 * first tap on Connect used to fail and the second one worked: by then the
 * adapter had powered on by itself.
 *
 * `Unknown` is a not-yet, not a no, so it is waited out rather than reported.
 * On iOS it is also the state while the system Bluetooth permission dialog is
 * open, which is why the wait is generous — the rider may be reading it.
 */
async function waitForPoweredOnAdapter(manager: BleManager, timeoutMs = 10000) {
  if ((await manager.state()) === State.PoweredOn) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let subscription: Subscription | null = null;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(
      () => finish(new Error("Bluetooth did not become ready. Try again.")),
      timeoutMs
    );

    // `true` re-emits the current state, closing the gap between the check
    // above and this subscription: a radio that powered on in between would
    // otherwise be waited on for a change that had already happened.
    subscription = manager.onStateChange((next) => {
      if (next === State.PoweredOn) {
        finish();
        return;
      }

      const message = adapterStateMessages[next];

      if (message) {
        finish(new Error(message));
      }
    }, true);
  });
}

export async function connectToXiao(
  options: ConnectOptions = {}
): Promise<XiaoBleConnection> {
  const canScan = await requestXiaoBlePermissions();

  if (!canScan) {
    throw new Error("Bluetooth permission was not granted.");
  }

  const bleManager = getManager();

  await waitForPoweredOnAdapter(bleManager);

  const timeoutMs = options.timeoutMs ?? 15000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let sampleSubscription: Subscription | null = null;

    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      bleManager.stopDeviceScan();
      reject(error);
    };

    const timeout = setTimeout(() => {
      finishWithError(new Error(`Could not find ${XIAO_BLE_DEVICE_NAME}.`));
    }, timeoutMs);

    const finishWithDevice = async (device: Device) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      bleManager.stopDeviceScan();

      try {
        const connectedDevice = await device.connect({ autoConnect: false });
        let readyDevice = await connectedDevice.discoverAllServicesAndCharacteristics();
        if (Platform.OS === "android") {
          try {
            readyDevice = await readyDevice.requestMTU(517);
          } catch {
            // The protocol also works with a smaller negotiated MTU, using more pages.
          }
        }

        let requestId = Math.floor(Math.random() * 0xffff);
        const researchRequest = async (op: number, captureId = 0, arg = 0) => {
          requestId = (requestId + 1) & 0xffff;
          let lastError: Error | null = null;
          for (let attempt = 0; attempt < (op === OP.START ? 1 : 3); attempt++) {
            try {
              await readyDevice.writeCharacteristicWithResponseForService(
                XIAO_BLE_SERVICE_UUID,
                RESEARCH_CONTROL_UUID,
                bytesToBase64(command(op, requestId, captureId, arg))
              );
              const deadline = Date.now() + 5000;
              while (Date.now() < deadline) {
                const characteristic = await readyDevice.readCharacteristicForService(
                  XIAO_BLE_SERVICE_UUID,
                  RESEARCH_RESPONSE_UUID
                );
                if (characteristic.value) {
                  const bytes = base64ToBytes(characteristic.value);
                  if (bytes.length >= 24) {
                    const response = parseResponse(bytes);
                    if (response.request === requestId && response.op === op) {
                      if (response.flags) throw new Error(`Board rejected request (${response.flags}).`);
                      if ((op === OP.RAW || op === OP.SUMMARIES) &&
                          (response.captureId !== captureId || response.offset !== arg)) {
                        throw new Error("Research page identity mismatch");
                      }
                      return response;
                    }
                  }
                }
                await sleep(30);
              }
              throw new Error("Research response timed out");
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error));
              await sleep(150);
            }
          }
          throw lastError ?? new Error("Research request failed");
        };

        sampleSubscription = readyDevice.monitorCharacteristicForService(
          XIAO_BLE_SERVICE_UUID,
          XIAO_BLE_IMU_CHARACTERISTIC_UUID,
          (error, characteristic) => {
            if (error) {
              console.log("XIAO BLE sample monitor error", error);
              return;
            }

            if (!characteristic?.value || !options.onSample) {
              return;
            }

            options.onSample(parseXiaoImuPacket(base64ToBytes(characteristic.value)));
          }
        );

        resolve({
          deviceId: readyDevice.id,
          deviceName: readyDevice.name ?? readyDevice.localName ?? XIAO_BLE_DEVICE_NAME,
          disconnect: async () => {
            sampleSubscription?.remove();
            await bleManager.cancelDeviceConnection(readyDevice.id);
          },
          setSampleInterval: async (intervalMs: number) => {
            await readyDevice.writeCharacteristicWithResponseForService(
              XIAO_BLE_SERVICE_UUID,
              XIAO_BLE_CONFIG_CHARACTERISTIC_UUID,
              uint16ToBase64(intervalMs)
            );
          },
          getResearchStatus: async () => parseStatus(await researchRequest(OP.STATUS)),
          startResearchCapture: async (seconds, rateHz) =>
            parseStatus(await researchRequest(OP.START, 0, startArgument(seconds, rateHz))),
          retrieveResearchCapture: async (status, transfer, onProgress) => {
            if (transfer.captureId !== status.captureId) {
              throw new Error("The partial transfer belongs to another capture.");
            }
            const total = status.count * status.rawStride + status.windows * 24;
            const notify = () => onProgress?.(
              transfer.rawReceived * status.rawStride + transfer.summariesReceived * 24,
              total
            );

            const attemptStartedAt = Date.now();
            try {
              while (transfer.rawReceived < status.count) {
                const response = await researchRequest(OP.RAW, status.captureId, transfer.rawReceived);
                if (!response.count || response.payload.length !== response.count * status.rawStride ||
                    transfer.rawReceived + response.count > status.count) {
                  throw new Error("Invalid raw research page");
                }
                transfer.raw.set(response.payload, transfer.rawReceived * status.rawStride);
                transfer.rawReceived += response.count;
                notify();
              }
              while (transfer.summariesReceived < status.windows) {
                const response = await researchRequest(OP.SUMMARIES, status.captureId, transfer.summariesReceived);
                if (!response.count || response.payload.length !== response.count * 24 ||
                    transfer.summariesReceived + response.count > status.windows) {
                  throw new Error("Invalid summary research page");
                }
                transfer.summaries.set(response.payload, transfer.summariesReceived * 24);
                transfer.summariesReceived += response.count;
                notify();
              }
              return transfer;
            } finally {
              transfer.transferMs += Date.now() - attemptStartedAt;
            }
          },
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    bleManager.startDeviceScan(
      [XIAO_BLE_SERVICE_UUID],
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          finishWithError(error);
          return;
        }

        if (!device) {
          return;
        }

        const names = [device.name, device.localName].filter(Boolean).join(" ");
        const advertisedServiceUuids = device.serviceUUIDs ?? [];
        const isXiao =
          names.includes("XIAO") ||
          names.includes("Skate") ||
          advertisedServiceUuids.some(
            (uuid) => uuid.toLowerCase() === XIAO_BLE_SERVICE_UUID
          );

        if (isXiao) {
          finishWithDevice(device);
        }
      }
    );
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function createResearchTransfer(status: ResearchStatus): ResearchTransfer {
  return {
    captureId: status.captureId,
    raw: new Uint8Array(status.count * status.rawStride),
    summaries: new Uint8Array(status.windows * 24),
    rawReceived: 0,
    summariesReceived: 0,
    transferMs: 0,
  };
}

function base64ToBytes(value: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = value.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of clean) {
    const index = chars.indexOf(char);
    if (index < 0) continue;

    buffer = (buffer << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

function uint16ToBase64(value: number) {
  const clamped = Math.max(10, Math.min(1000, Math.round(value)));
  const bytes = [clamped & 0xff, (clamped >> 8) & 0xff];
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  const triplet = bytes[0] << 16 | bytes[1] << 8;
  output += chars[(triplet >> 18) & 0x3f];
  output += chars[(triplet >> 12) & 0x3f];
  output += chars[(triplet >> 6) & 0x3f];
  output += "=";

  return output;
}

function bytesToBase64(bytes: Uint8Array) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triplet = (first << 16) | (second << 8) | third;
    output += chars[(triplet >> 18) & 0x3f];
    output += chars[(triplet >> 12) & 0x3f];
    output += index + 1 < bytes.length ? chars[(triplet >> 6) & 0x3f] : "=";
    output += index + 2 < bytes.length ? chars[triplet & 0x3f] : "=";
  }
  return output;
}
