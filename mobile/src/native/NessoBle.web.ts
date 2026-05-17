import type {
  NessoFeatureFrame,
  NessoImuPacket,
  NessoRawBurstSample,
  NessoRawBurstStatus,
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

export function isNessoBleSupported() {
  return false;
}

export async function requestNessoBlePermissions() {
  return false;
}

export async function connectToNesso(
  _options: ConnectOptions = {}
): Promise<NessoBleConnection> {
  throw new Error("Nesso BLE is only available in native mobile builds.");
}

