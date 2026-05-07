import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, type Device, type Subscription } from "react-native-ble-plx";
import {
  NESSO_BLE_CONFIG_CHARACTERISTIC_UUID,
  NESSO_BLE_DEVICE_NAME,
  NESSO_BLE_IMU_CHARACTERISTIC_UUID,
  NESSO_BLE_SERVICE_UUID,
  parseNessoImuPacket,
  type NessoImuPacket,
} from "@skate-route-mapper/shared";

export type NessoBleConnection = {
  deviceId: string;
  deviceName: string;
  disconnect: () => Promise<void>;
  setSampleInterval: (intervalMs: number) => Promise<void>;
};

type ConnectOptions = {
  timeoutMs?: number;
  onSample?: (sample: NessoImuPacket) => void;
};

let manager: BleManager | null = null;

function getManager() {
  if (!manager) {
    manager = new BleManager();
  }

  return manager;
}

export function isNessoBleSupported() {
  return Platform.OS === "android" || Platform.OS === "ios";
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
      finishWithError(new Error(`Could not find ${NESSO_BLE_DEVICE_NAME}.`));
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
          NESSO_BLE_SERVICE_UUID,
          NESSO_BLE_IMU_CHARACTERISTIC_UUID,
          (error, characteristic) => {
            if (error) {
              console.log("Nesso BLE sample monitor error", error);
              return;
            }

            if (!characteristic?.value || !options.onSample) {
              return;
            }

            options.onSample(parseNessoImuPacket(base64ToBytes(characteristic.value)));
          }
        );

        resolve({
          deviceId: readyDevice.id,
          deviceName: readyDevice.name ?? readyDevice.localName ?? NESSO_BLE_DEVICE_NAME,
          disconnect: async () => {
            sampleSubscription?.remove();
            await bleManager.cancelDeviceConnection(readyDevice.id);
          },
          setSampleInterval: async (intervalMs: number) => {
            await readyDevice.writeCharacteristicWithResponseForService(
              NESSO_BLE_SERVICE_UUID,
              NESSO_BLE_CONFIG_CHARACTERISTIC_UUID,
              uint16ToBase64(intervalMs)
            );
          },
        });
      } catch (error) {
        finishWithError(error instanceof Error ? error : new Error(String(error)));
      }
    };

    bleManager.startDeviceScan(
      [NESSO_BLE_SERVICE_UUID],
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
          names.includes("Nesso") ||
          advertisedServiceUuids.some(
            (uuid) => uuid.toLowerCase() === NESSO_BLE_SERVICE_UUID
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

