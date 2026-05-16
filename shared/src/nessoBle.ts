export const NESSO_BLE_DEVICE_NAME = "Skate Nesso N1";
export const NESSO_GATE_A_BLE_DEVICE_NAME = "Skate Nesso N1 Gate A";
export const NESSO_BLE_SERVICE_UUID = "7b32f8c0-5d0b-4f0e-a1f5-8f30c44c0001";
export const NESSO_BLE_IMU_CHARACTERISTIC_UUID =
  "7b32f8c1-5d0b-4f0e-a1f5-8f30c44c0001";
export const NESSO_BLE_CONFIG_CHARACTERISTIC_UUID =
  "7b32f8c2-5d0b-4f0e-a1f5-8f30c44c0001";
export const NESSO_GATE_A_BLE_SERVICE_UUID =
  "7b32f8d0-5d0b-4f0e-a1f5-8f30c44c0001";
export const NESSO_GATE_A_BLE_FEATURE_CHARACTERISTIC_UUID =
  "7b32f8d1-5d0b-4f0e-a1f5-8f30c44c0001";
export const NESSO_GATE_A_BLE_CONFIG_CHARACTERISTIC_UUID =
  "7b32f8d2-5d0b-4f0e-a1f5-8f30c44c0001";

export const NESSO_BLE_IMU_PACKET_SIZE = 20;
export const NESSO_BLE_FEATURE_PACKET_TYPE = 0x02;
export const NESSO_BLE_FEATURE_PROTOCOL_VERSION = 1;

export type NessoImuPacket = {
  type: "raw";
  sequence: number;
  uptimeMs: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
};

export type NessoFeatureFrame = {
  type: "feature";
  protocolVersion: number;
  sequence: number;
  uptimeMs: number;
  windowMs: number;
  rawSampleCount: number;
  accelRms: number;
  accelPeakToPeak: number;
  roughnessLevel: 1 | 2 | 3 | 4 | 5 | 6;
  confidence: number;
};

export type NessoMotionPacket = NessoImuPacket | NessoFeatureFrame;

export function parseNessoMotionPacket(bytes: Uint8Array): NessoMotionPacket {
  if (
    bytes.byteLength === NESSO_BLE_IMU_PACKET_SIZE &&
    bytes[0] === NESSO_BLE_FEATURE_PACKET_TYPE &&
    bytes[1] === NESSO_BLE_FEATURE_PROTOCOL_VERSION &&
    bytes[18] >= 1 &&
    bytes[18] <= 6 &&
    bytes[19] <= 100
  ) {
    return parseNessoFeatureFrame(bytes);
  }

  return parseNessoImuPacket(bytes);
}

export function parseNessoImuPacket(bytes: Uint8Array): NessoImuPacket {
  if (bytes.byteLength !== NESSO_BLE_IMU_PACKET_SIZE) {
    throw new Error(
      `Expected ${NESSO_BLE_IMU_PACKET_SIZE} bytes, received ${bytes.byteLength}`
    );
  }

  const packet = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    type: "raw",
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

export function parseNessoFeatureFrame(bytes: Uint8Array): NessoFeatureFrame {
  if (bytes.byteLength !== NESSO_BLE_IMU_PACKET_SIZE) {
    throw new Error(
      `Expected ${NESSO_BLE_IMU_PACKET_SIZE} bytes, received ${bytes.byteLength}`
    );
  }

  const packet = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packetType = packet.getUint8(0);

  if (packetType !== NESSO_BLE_FEATURE_PACKET_TYPE) {
    throw new Error(`Expected Nesso feature packet type ${NESSO_BLE_FEATURE_PACKET_TYPE}`);
  }

  const roughnessLevel = packet.getUint8(18);

  return {
    type: "feature",
    protocolVersion: packet.getUint8(1),
    windowMs: packet.getUint16(2, true),
    sequence: packet.getUint32(4, true),
    uptimeMs: packet.getUint32(8, true),
    rawSampleCount: packet.getUint16(12, true),
    accelRms: packet.getUint16(14, true) / 1000,
    accelPeakToPeak: packet.getUint16(16, true) / 1000,
    roughnessLevel: clampRoughnessLevel(roughnessLevel),
    confidence: packet.getUint8(19) / 100,
  };
}

function clampRoughnessLevel(value: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (value <= 1) return 1;
  if (value >= 6) return 6;
  return value as 1 | 2 | 3 | 4 | 5 | 6;
}

