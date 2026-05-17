import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import { BleManager, type Device, type Subscription } from "react-native-ble-plx";
import {
  NESSO_GATE_A_BLE_DEVICE_NAME,
  NESSO_GATE_A_BLE_CONFIG_CHARACTERISTIC_UUID,
  NESSO_GATE_A_BLE_FEATURE_CHARACTERISTIC_UUID,
  NESSO_GATE_A_BLE_SERVICE_UUID,
  NESSO_BLE_COMMAND_RAW_BURST_CAPTURE,
  parseNessoMotionPacket,
  type NessoFeatureFrame,
  type NessoImuPacket,
  type NessoRawBurstSample,
  type NessoRawBurstStatus,
} from "@skate-route-mapper/shared/nessoBle";

export type NessoBleConnection = {
  deviceId: string;
  deviceName: string;
  disconnect: () => Promise<void>;
  setSampleInterval: (intervalMs: number) => Promise<void>;
  startRawBurstCapture: (durationMs: number) => Promise<void>;
};

type ConnectOptions = {
  timeoutMs?: number;
  onSample?: (sample: NessoImuPacket) => void;
  onFeatureFrame?: (frame: NessoFeatureFrame) => void;
  onRawBurstSample?: (sample: NessoRawBurstSample, packetBase64: string) => void;
  onRawBurstStatus?: (status: NessoRawBurstStatus) => void;
  onError?: (message: string) => void;
};

let manager: BleManager | null = null;

function hasNativeBleModule() {
  return NativeModules.BlePlx != null;
}

function getManager() {
  if (!hasNativeBleModule()) {
    throw new Error(
      "Nesso BLE requires a development/native build with react-native-ble-plx included. Rebuild the iOS app after installing native modules; Expo Go cannot connect to Nesso N1."
    );
  }

  if (!manager) {
    manager = new BleManager();
  }

  return manager;
}

export function isNessoBleSupported() {
  return (Platform.OS === "android" || Platform.OS === "ios") && hasNativeBleModule();
}

export async function requestNessoBlePermissions() {
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

export async function connectToNesso(
  options: ConnectOptions = {}
): Promise<NessoBleConnection> {
  const canScan = await requestNessoBlePermissions();

  if (!canScan) {
    throw new Error("Bluetooth permission was not granted.");
  }

  const bleManager = getManager();
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
      finishWithError(new Error(`Could not find ${NESSO_GATE_A_BLE_DEVICE_NAME}.`));
    }, timeoutMs);

    const finishWithDevice = async (device: Device) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      bleManager.stopDeviceScan();

      try {
        const connectedDevice = await device.connect({ autoConnect: false });
        const readyDevice = await connectedDevice.discoverAllServicesAndCharacteristics();

        sampleSubscription = readyDevice.monitorCharacteristicForService(
          NESSO_GATE_A_BLE_SERVICE_UUID,
          NESSO_GATE_A_BLE_FEATURE_CHARACTERISTIC_UUID,
          (error, characteristic) => {
            if (error) {
              console.log("Nesso BLE sample monitor error", error);
              return;
            }

            if (!characteristic?.value) {
              return;
            }

            let packet: NessoImuPacket | NessoFeatureFrame;

            try {
              packet = parseNessoMotionPacket(base64ToBytes(characteristic.value));
            } catch (parseError) {
              const message =
                parseError instanceof Error
                  ? parseError.message
                  : "Unable to parse Nesso BLE packet.";
              console.log("Nesso BLE packet parse error", message);
              options.onError?.(message);
              return;
            }

            if (packet.type === "feature") {
              options.onFeatureFrame?.(packet);
            } else if (packet.type === "raw") {
              options.onSample?.(packet);
            } else if (packet.type === "rawBurstSample") {
              options.onRawBurstSample?.(packet, characteristic.value);
            } else {
              options.onRawBurstStatus?.(packet);
            }
          }
        );

        resolve({
          deviceId: readyDevice.id,
          deviceName: readyDevice.name ?? readyDevice.localName ?? NESSO_GATE_A_BLE_DEVICE_NAME,
          disconnect: async () => {
            sampleSubscription?.remove();
            await bleManager.cancelDeviceConnection(readyDevice.id);
          },
          setSampleInterval: async (intervalMs: number) => {
            await readyDevice.writeCharacteristicWithResponseForService(
              NESSO_GATE_A_BLE_SERVICE_UUID,
              NESSO_GATE_A_BLE_CONFIG_CHARACTERISTIC_UUID,
              uint16ToBase64(intervalMs)
            );
          },
          startRawBurstCapture: async (durationMs: number) => {
            await readyDevice.writeCharacteristicWithResponseForService(
              NESSO_GATE_A_BLE_SERVICE_UUID,
              NESSO_GATE_A_BLE_CONFIG_CHARACTERISTIC_UUID,
              rawBurstCommandToBase64(durationMs)
            );
          },
        });
      } catch (error) {
        finishWithError(error instanceof Error ? error : new Error(String(error)));
      }
    };

    bleManager.startDeviceScan(
      [NESSO_GATE_A_BLE_SERVICE_UUID],
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
        const isNesso =
          names.includes("Gate A") ||
          advertisedServiceUuids.some(
            (uuid) => uuid.toLowerCase() === NESSO_GATE_A_BLE_SERVICE_UUID
          );

        if (isNesso) {
          finishWithDevice(device);
        }
      }
    );
  });
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
  const clamped = Math.max(100, Math.min(1000, Math.round(value)));
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

function rawBurstCommandToBase64(durationMs: number) {
  const clamped = Math.max(1000, Math.min(10000, Math.round(durationMs)));
  return bytesToBase64([
    NESSO_BLE_COMMAND_RAW_BURST_CAPTURE,
    clamped & 0xff,
    (clamped >> 8) & 0xff,
  ]);
}

function bytesToBase64(bytes: number[]) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triplet = (first << 16) | (second << 8) | third;

    output += chars[(triplet >> 18) & 0x3f];
    output += chars[(triplet >> 12) & 0x3f];
    output += index + 1 < bytes.length ? chars[(triplet >> 6) & 0x3f] : "=";
    output += index + 2 < bytes.length ? chars[triplet & 0x3f] : "=";
  }

  return output;
}

