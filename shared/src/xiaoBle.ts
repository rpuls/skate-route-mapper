export const XIAO_BLE_DEVICE_NAME = "Skate XIAO IMU";
export const XIAO_BLE_SERVICE_UUID = "7b32f8d0-5d0b-4f0e-a1f5-8f30c44c0001";
export const XIAO_BLE_IMU_CHARACTERISTIC_UUID =
  "7b32f8d1-5d0b-4f0e-a1f5-8f30c44c0001";
export const XIAO_BLE_CONFIG_CHARACTERISTIC_UUID =
  "7b32f8d2-5d0b-4f0e-a1f5-8f30c44c0001";

export const XIAO_BLE_IMU_PACKET_SIZE = 20;

export type XiaoImuPacket = {
  sequence: number;
  uptimeMs: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
};

export function parseXiaoImuPacket(bytes: Uint8Array): XiaoImuPacket {
  if (bytes.byteLength !== XIAO_BLE_IMU_PACKET_SIZE) {
    throw new Error(
      `Expected ${XIAO_BLE_IMU_PACKET_SIZE} bytes, received ${bytes.byteLength}`
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
