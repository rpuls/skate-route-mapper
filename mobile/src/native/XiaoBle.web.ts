import type { XiaoImuPacket } from "@skate-route-mapper/shared/xiaoBle";

export type XiaoBleConnection = {
  deviceId: string;
  deviceName: string;
  disconnect: () => Promise<void>;
  setSampleInterval: (intervalMs: number) => Promise<void>;
  getResearchStatus: () => Promise<never>;
  startResearchCapture: () => Promise<never>;
  retrieveResearchCapture: () => Promise<never>;
  /**
   * Unreachable: nothing on web ever holds a connection to open a stream on,
   * because `connectToXiao` throws. Declared so the two connection types stay
   * the same shape.
   */
  readStream: () => never;
};

export type ResearchTransfer = never;

export function createResearchTransfer(): never {
  throw new Error("XIAO research capture is only available in native mobile builds.");
}

type ConnectOptions = {
  timeoutMs?: number;
  onSample?: (sample: XiaoImuPacket) => void;
};

export function isXiaoBleSupported() {
  return false;
}

export async function requestXiaoBlePermissions() {
  return false;
}

export async function connectToXiao(
  _options: ConnectOptions = {}
): Promise<XiaoBleConnection> {
  throw new Error("XIAO BLE is only available in native mobile builds.");
}
