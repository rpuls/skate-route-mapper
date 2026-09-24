import { create } from "zustand";
import * as Crypto from "expo-crypto";
import type { RideMetrics } from "@skate-route-mapper/shared/rideTracking";
import type {
  MeasurementStatus,
  ExternalImuPacket,
  ExternalImuDevice,
  SensorSource,
  VehicleType,
} from "../types/measurement";
import { createRide, getActiveRecording, setActiveRecording } from "../database/db";
import {
  isBackgroundLocationRunning,
  requestLocationPermissions,
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
  type LocationPermissionState,
} from "../recording/backgroundLocation";
import { rideRecorder } from "../recording/recorder";
import type { RecordingSnapshot } from "../recording/rideRecorder";
import { requestSync } from "../sync/autoSync";

export type StartRecordingResult =
  | { ok: true; rideId: string; permissions: LocationPermissionState }
  | { ok: false; message: string };

type MeasurementState = {
  vehicleType: VehicleType;
  sensorSource: SensorSource;
  status: MeasurementStatus;
  externalImuDevice: ExternalImuDevice | null;
  latestExternalImuSample: ExternalImuPacket | null;
  /** Live figures for the recording screen, refreshed as fixes arrive. */
  recording: RecordingSnapshot | null;
  /** What the ride that just finished covered, for the home screen to confirm. */
  lastRideMetrics: RideMetrics | null;
  permissionMessage: string | null;

  setVehicleType: (vehicleType: VehicleType) => void;
  setSensorSource: (sensorSource: SensorSource) => void;
  setExternalImuDevice: (device: ExternalImuDevice | null) => void;
  setLatestExternalImuSample: (sample: ExternalImuPacket | null) => void;

  startRecording: () => Promise<StartRecordingResult>;
  stopRecording: () => Promise<void>;
  /** Re-attach to a recording that outlived the app being closed. */
  resumeRecording: () => Promise<void>;
};

export const useMeasurementStore = create<MeasurementState>((set, get) => ({
  vehicleType: "skates",
  sensorSource: "phone",
  status: "ready",
  externalImuDevice: null,
  latestExternalImuSample: null,
  recording: null,
  lastRideMetrics: null,
  permissionMessage: null,

  setVehicleType: (vehicleType) => set({ vehicleType }),
  setSensorSource: (sensorSource) => set({ sensorSource }),
  setExternalImuDevice: (device) => set({ externalImuDevice: device }),

  setLatestExternalImuSample: (sample) => {
    set({ latestExternalImuSample: sample });

    if (sample && get().status === "recording" && get().sensorSource === "external") {
      rideRecorder.recordExternalSample(sample);
    }
  },

  startRecording: async () => {
    const permissions = await requestLocationPermissions();

    if (!permissions.foreground) {
      set({ permissionMessage: permissions.message });

      return {
        ok: false,
        message: permissions.message ?? "Location permission is needed to record a route.",
      };
    }

    // A ride left open by a crash or a double tap would otherwise be orphaned:
    // still marked active, never finished, never uploaded.
    if (getActiveRecording()) {
      rideRecorder.end();
    }

    const rideId = Crypto.randomUUID();
    const startedAt = Date.now();
    const sensorSource = get().sensorSource;

    createRide({
      id: rideId,
      startedAt,
      vehicleType: get().vehicleType,
      sensorSource,
    });

    setActiveRecording({ rideId, sensorSource, startedAt });
    rideRecorder.begin({ rideId, sensorSource, startedAt });

    try {
      await startBackgroundLocationUpdates();
    } catch (error) {
      // The ride row exists and the recorder is live, so a rider still gets a
      // ride; they just will not get fixes. Saying so beats a silent failure.
      set({
        permissionMessage:
          error instanceof Error
            ? `Location updates could not start: ${error.message}`
            : "Location updates could not start.",
      });
    }

    set({
      status: "recording",
      permissionMessage: permissions.message,
      recording: rideRecorder.getSnapshot(),
    });

    return { ok: true, rideId, permissions };
  },

  stopRecording: async () => {
    await stopBackgroundLocationUpdates();

    const finished = rideRecorder.end();

    set({
      status: "finished",
      recording: null,
      lastRideMetrics: finished?.metrics ?? null,
    });

    // A finished ride is the one moment a rider expects their data to leave
    // the phone, so the upload starts without being asked.
    void requestSync("ride-finished");
  },

  resumeRecording: async () => {
    const active = getActiveRecording();

    if (!active) {
      return;
    }

    rideRecorder.begin(active);

    try {
      // Only start updates that are not already running: restarting a live
      // subscription can cost the fix it was about to deliver.
      if (!(await isBackgroundLocationRunning())) {
        await startBackgroundLocationUpdates();
      }
    } catch {
      // Not permitted any more, or the task is gone. The ride is still open
      // and can be finished from the recording screen either way.
    }

    set({
      status: "recording",
      sensorSource: active.sensorSource,
      recording: rideRecorder.getSnapshot(),
    });
  },
}));

// Fixes arrive from the OS, not from React, so the store is updated by the
// recorder rather than the other way round.
rideRecorder.subscribe((snapshot) => {
  useMeasurementStore.setState({ recording: snapshot });
});
