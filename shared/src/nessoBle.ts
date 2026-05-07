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

export function parseNessoImuPacket(bytes: Uint8Array): NessoImuPacket {
  if (bytes.byteLength !== NESSO_BLE_IMU_PACKET_SIZE) {
    throw new Error(
      `Expected ${NESSO_BLE_IMU_PACKET_SIZE} bytes, received ${bytes.byteLength}`
    );
  }

  const packet = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    sequence: packet.getUint32(0, true),
    uptimeMs: packet.getUint32(4, true),
    ax: packet.getInt16(8, true) / 1000,
    ay: packet.getInt16(10, true) / 1000,
    az: packet.getInt16(12, true) / 1000,
    gx: (packet.getInt16(14, true) / 1000) * (Math.PI / 180),
    gy: (packet.getInt16(16, true) / 1000) * (Math.PI / 180),
    gz: (packet.getInt16(18, true) / 1000) * (Math.PI / 180),
  };
}

