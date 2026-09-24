import { create } from "zustand";
import * as Crypto from "expo-crypto";
import { vehicleTypes } from "@skate-route-mapper/shared/mobileContracts";
import type { RideMetrics } from "@skate-route-mapper/shared/rideTracking";
import type {
  MeasurementStatus,
  ExternalImuPacket,
  Ride,
  SensorSource,
  VehicleType,
} from "../types/measurement";
import {
  createRide,
  getActiveRecording,
  getLastFinishedRide,
  setActiveRecording,
} from "../database/db";
import {
  setXiaoSampleInterval,
  subscribeToXiaoSamples,
  useXiaoConnection,
} from "../native/xiaoConnection";
import {
  isBackgroundLocationRunning,
  requestLocationPermissions,
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
  type LocationPermissionState,
} from "../recording/backgroundLocation";
import { rideRecorder } from "../recording/recorder";
import type { RecordingSnapshot } from "../recording/rideRecorder";
import {
  preferenceKeys,
  readPreference,
  writePreference,
} from "../storage/preferences";
import { requestSync } from "../sync/autoSync";

export type StartRecordingResult =
  | { ok: true; rideId: string; permissions: LocationPermissionState }
  | { ok: false; message: string };

/**
 * How often a board reading is allowed to re-render the screen.
 *
 * The XIAO streams around 20 readings a second and every one of them is
 * recorded, but a surface read-out that changes 20 times a second is unusable
 * and re-rendering a map that often is worse. The recorder gets the full
 * stream; the UI gets four updates a second.
 */
const uiSampleIntervalMs = 250;

type MeasurementState = {
  vehicleType: VehicleType;
  /** What the *active* ride is recording with. Set when the ride starts. */
  sensorSource: SensorSource;
  status: MeasurementStatus;
  latestExternalImuSample: ExternalImuPacket | null;
  /** Live figures for the ride screen, refreshed as fixes arrive. */
  recording: RecordingSnapshot | null;
  /** What the ride that just finished covered, for the start screen to confirm. */
  lastRideMetrics: RideMetrics | null;
  permissionMessage: string | null;
  /** Set while a ride is open but not collecting. */
  pausedAt: number | null;
  /** Time already spent paused in this ride, so the timer shows recorded time. */
  pausedMs: number;

  setVehicleType: (vehicleType: VehicleType) => void;

  startRecording: () => Promise<StartRecordingResult>;
  stopRecording: () => Promise<void>;
  pauseRide: () => Promise<void>;
  resumeRide: () => Promise<void>;
  /** Re-attach to a recording that outlived the app being closed. */
  resumeRecording: () => Promise<void>;
};

export const useMeasurementStore = create<MeasurementState>((set, get) => ({
  vehicleType: "skates",
  sensorSource: "phone",
  status: "ready",
  latestExternalImuSample: null,
  recording: null,
  lastRideMetrics: null,
  permissionMessage: null,
  pausedAt: null,
  pausedMs: 0,

  setVehicleType: (vehicleType) => {
    set({ vehicleType });
    void writePreference(preferenceKeys.vehicleType, vehicleType);
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

    // The sensor source is no longer a separate thing to choose. A ride that
    // has the board connected records surface data; one that does not, does
    // not. Asking twice only created a state where the sensor was paired and
    // silently unused.
    const sensorSource: SensorSource =
      useXiaoConnection.getState().status === "connected" ? "external" : "phone";

    createRide({
      id: rideId,
      startedAt,
      vehicleType: get().vehicleType,
      sensorSource,
    });

    setActiveRecording({ rideId, sensorSource, startedAt });
    rideRecorder.begin({ rideId, sensorSource, startedAt });

    if (sensorSource === "external") {
      // 20 readings a second is enough to characterise a stretch of road and
      // little enough that the board and the phone both survive a long ride.
      void setXiaoSampleInterval(50);
    }

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
      sensorSource,
      permissionMessage: permissions.message,
      recording: rideRecorder.getSnapshot(),
      pausedAt: null,
      pausedMs: 0,
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
      pausedAt: null,
      pausedMs: 0,
    });

    // A finished ride is the one moment a rider expects their data to leave
    // the phone, so the upload starts without being asked.
    void requestSync("ride-finished");
  },

  /**
   * Stop collecting without ending the ride.
   *
   * Location updates are stopped rather than merely ignored, because a paused
   * ride should not be spending battery on GPS, and a fix that is never
   * delivered cannot be mistakenly folded in. The recorder is told to end its
   * segment so the stretch skipped over is never drawn or counted.
   */
  pauseRide: async () => {
    if (!get().recording || get().pausedAt !== null) {
      return;
    }

    set({ pausedAt: Date.now() });
    await stopBackgroundLocationUpdates();
    rideRecorder.breakSegment();
    set({ status: "paused", recording: rideRecorder.getSnapshot() });
  },

  resumeRide: async () => {
    const pausedAt = get().pausedAt;

    if (!get().recording || pausedAt === null) {
      return;
    }

    set({
      pausedAt: null,
      pausedMs: get().pausedMs + Math.max(0, Date.now() - pausedAt),
      status: "recording",
    });

    try {
      await startBackgroundLocationUpdates();
    } catch (error) {
      set({
        permissionMessage:
          error instanceof Error
            ? `Location updates could not restart: ${error.message}`
            : "Location updates could not restart.",
      });
    }
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
      // and can be finished from the ride screen either way.
    }

    // A pause is not carried across a restart. It only exists while the app
    // does, and relaunching into a live recording is the safer of the two
    // wrong answers: a rider who meant to stop can still stop.
    set({
      status: "recording",
      sensorSource: active.sensorSource,
      recording: rideRecorder.getSnapshot(),
      pausedAt: null,
      pausedMs: 0,
    });
  },
}));

/**
 * Seconds of ride actually recorded, with paused time taken out.
 *
 * Wall-clock elapsed time would keep climbing through a coffee stop, which
 * makes the average speed it feeds meaningless.
 */
export function recordedSeconds(
  state: Pick<MeasurementState, "recording" | "pausedAt" | "pausedMs">,
  now = Date.now()
) {
  if (!state.recording) {
    return 0;
  }

  const pausedSoFar =
    state.pausedMs + (state.pausedAt === null ? 0 : Math.max(0, now - state.pausedAt));

  return Math.max(0, (now - state.recording.startedAt - pausedSoFar) / 1000);
}

/**
 * Restore what should already be true when a screen first paints.
 *
 * Both of these are facts about the phone rather than about this session, and
 * both were previously only ever set as a side effect of doing something in
 * the app — so closing it lost your ride type and your last ride, and the ride
 * screen came back claiming you had never ridden.
 */
export async function hydrateMeasurementStore() {
  const stored = await readPreference(preferenceKeys.vehicleType);

  if (stored && (vehicleTypes as readonly string[]).includes(stored)) {
    useMeasurementStore.setState({ vehicleType: stored as VehicleType });
  }

  // Only when nothing has finished in this session: a ride that just ended has
  // fresher figures than the row it was written from.
  if (!useMeasurementStore.getState().lastRideMetrics) {
    const last = getLastFinishedRide();

    if (last) {
      useMeasurementStore.setState({ lastRideMetrics: rideMetricsFromRow(last) });
    }
  }
}

/**
 * A stored ride row as the metrics the ride screen shows.
 *
 * The row carries the totals; elapsed time and average speed are derived from
 * them the same way `summarizeRideProgress` derives them live.
 */
function rideMetricsFromRow(ride: Ride): RideMetrics {
  return {
    distanceMeters: ride.distanceMeters,
    movingSeconds: ride.movingSeconds,
    elapsedSeconds:
      ride.endedAt === null ? 0 : Math.max(0, (ride.endedAt - ride.startedAt) / 1000),
    avgSpeedMps:
      ride.movingSeconds > 0 ? ride.distanceMeters / ride.movingSeconds : 0,
    maxSpeedMps: ride.maxSpeedMps,
    acceptedFixCount: ride.acceptedFixCount,
    rejectedFixCount: ride.rejectedFixCount,
  };
}

// Fixes arrive from the OS, not from React, so the store is updated by the
// recorder rather than the other way round.
rideRecorder.subscribe((snapshot) => {
  useMeasurementStore.setState({ recording: snapshot });
});

// Board readings arrive from the BLE radio, which is also not React, and which
// keeps streaming while the ride screen is unmounted behind the research lab.
let lastUiSampleAt = 0;

subscribeToXiaoSamples((sample) => {
  const state = useMeasurementStore.getState();

  if (state.status === "recording" && state.sensorSource === "external") {
    rideRecorder.recordExternalSample(sample);
  }

  const now = Date.now();

  if (now - lastUiSampleAt >= uiSampleIntervalMs) {
    lastUiSampleAt = now;
    useMeasurementStore.setState({ latestExternalImuSample: sample });
  }
});
