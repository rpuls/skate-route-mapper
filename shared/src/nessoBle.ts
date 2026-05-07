export const NESSO_BLE_DEVICE_NAME = "Skate Nesso N1";
export const NESSO_BLE_SERVICE_UUID = "7b32f8c0-5d0b-4f0e-a1f5-8f30c44c0001";
export const NESSO_BLE_IMU_CHARACTERISTIC_UUID =
  "7b32f8c1-5d0b-4f0e-a1f5-8f30c44c0001";
export const NESSO_BLE_CONFIG_CHARACTERISTIC_UUID =
  "7b32f8c2-5d0b-4f0e-a1f5-8f30c44c0001";

export const NESSO_BLE_IMU_PACKET_SIZE = 20;

export type NessoImuPacket = {
  sequence: number;
  uptimeMs: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
};

function readUint32Le(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readInt16Le(bytes: Uint8Array, offset: number) {
  const value = bytes[offset] | (bytes[offset + 1] << 8);
  return value & 0x8000 ? value - 0x10000 : value;
}

export function parseNessoImuPacket(bytes: Uint8Array): NessoImuPacket {
  if (bytes.byteLength !== NESSO_BLE_IMU_PACKET_SIZE) {
    throw new Error(
      `Expected ${NESSO_BLE_IMU_PACKET_SIZE} bytes, received ${bytes.byteLength}`
    );
  }

  return {
    sequence: readUint32Le(bytes, 0),
    uptimeMs: readUint32Le(bytes, 4),
    ax: readInt16Le(bytes, 8) / 1000,
    ay: readInt16Le(bytes, 10) / 1000,
    az: readInt16Le(bytes, 12) / 1000,
    gx: (readInt16Le(bytes, 14) / 1000) * (Math.PI / 180),
    gy: (readInt16Le(bytes, 16) / 1000) * (Math.PI / 180),
    gz: (readInt16Le(bytes, 18) / 1000) * (Math.PI / 180),
  };
}

