import { Platform } from "react-native";
import { requireNativeModule } from "expo-modules-core";

export type BackgroundRecorderSample = {
  timestamp: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  vibrationMagnitude: number;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
};

export type BackgroundRecorderStatus = {
  isRecording: boolean;
  rideId: string | null;
  sampleCount: number;
  filePath: string | null;
  latestSample: BackgroundRecorderSample | null;
};

type BackgroundRecorderModule = {
  startRecording: (rideId: string, intervalMs: number) => Promise<BackgroundRecorderStatus>;
  stopRecording: () => Promise<BackgroundRecorderStatus>;
  getStatus: () => Promise<BackgroundRecorderStatus>;
  readSamples: (rideId: string) => Promise<BackgroundRecorderSample[]>;
  clearSamples: (rideId: string) => Promise<void>;
};

let nativeModule: BackgroundRecorderModule | null = null;

if (Platform.OS === "android") {
  try {
    nativeModule = requireNativeModule<BackgroundRecorderModule>("BackgroundRecorder");
  } catch {
    nativeModule = null;
  }
}

function requireAndroidModule() {
  if (!nativeModule) {
    throw new Error("BackgroundRecorder is only available on Android native builds.");
  }

  return nativeModule;
}

export async function startRecording(rideId: string, intervalMs = 200) {
  return requireAndroidModule().startRecording(rideId, intervalMs);
}

export async function stopRecording() {
  return requireAndroidModule().stopRecording();
}

export async function getStatus() {
  return requireAndroidModule().getStatus();
}

export async function readSamples(rideId: string) {
  return requireAndroidModule().readSamples(rideId);
}

export async function clearSamples(rideId: string) {
  return requireAndroidModule().clearSamples(rideId);
}

export function isAvailable() {
  return Platform.OS === "android" && nativeModule != null;
}
