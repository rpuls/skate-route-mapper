import type {
  RideMetricsPayload,
  SensorSource,
} from "@skate-route-mapper/shared/mobileContracts";
import {
  summarizeRideProgress,
  type LocationFix,
  type LocationFixRejection,
  type RideMetrics,
  type RideProgress,
} from "@skate-route-mapper/shared/rideTracking";
import type { MeasurementSample } from "../types/measurement";
import {
  foldLocationFixes,
  sampleFromImuReading,
  type ImuReading,
} from "./recordingSamples";
import {
  createSampleBuffer,
  type SampleBuffer,
  type SampleBufferOptions,
} from "./sampleBuffer";

/**
 * The ride recorder owns what a recording *is*: which ride is active, what it
 * has covered so far, and which samples are waiting to be written.
 *
 * It deliberately knows nothing about `expo-location`, permissions or React.
 * Background location arrives from the OS with no component mounted, and on
 * Android it can arrive after the app was killed and restarted, so the state
 * that matters lives in storage and is reloaded rather than remembered.
 *
 * Storage arrives as a port rather than an import. `../database/db` resolves
 * to `expo-sqlite`, which cannot load under `node --test`, and the lifecycle
 * this module owns — flush before finish, carry progress across a restart,
 * hand the buffer over between rides — is exactly the part worth testing.
 * `recorder.ts` wires the real storage in.
 */

export type ActiveRecording = {
  rideId: string;
  sensorSource: SensorSource;
  startedAt: number;
};

/** What the recorder needs from storage, and nothing more. */
export type RecorderStore = {
  getActiveRecording: () => ActiveRecording | null;
  clearActiveRecording: () => void;
  getRideProgress: (rideId: string) => RideProgress;
  saveRideProgress: (rideId: string, progress: RideProgress) => void;
  insertSamples: (rideId: string, samples: MeasurementSample[]) => void;
  finishRide: (
    rideId: string,
    endedAt: number,
    metrics?: RideMetricsPayload | undefined
  ) => void;
};

export type RecordingSnapshot = {
  rideId: string;
  sensorSource: SensorSource;
  startedAt: number;
  metrics: RideMetrics;
  lastFix: LocationFix | null;
  lastRejection: LocationFixRejection | null;
  /** Samples waiting in memory. What is waiting to upload is a sync concern. */
  bufferedSamples: number;
};

export type FinishedRecording = {
  rideId: string;
  metrics: RideMetrics;
};

type RecordingListener = (snapshot: RecordingSnapshot | null) => void;

export type RideRecorder = {
  subscribe: (listener: RecordingListener) => () => void;
  begin: (recording: ActiveRecording) => void;
  recordLocationFixes: (fixes: readonly LocationFix[]) => RecordingSnapshot | null;
  recordExternalSample: (reading: ImuReading, recordedAt?: number) => void;
  /** End the current route segment without ending the ride. See below. */
  breakSegment: () => RecordingSnapshot | null;
  flush: () => number;
  getSnapshot: () => RecordingSnapshot | null;
  end: (endedAt?: number) => FinishedRecording | null;
};

export function createRideRecorder(
  store: RecorderStore,
  bufferOptions: SampleBufferOptions = {}
): RideRecorder {
  const listeners = new Set<RecordingListener>();

  let activeBuffer: { rideId: string; buffer: SampleBuffer } | null = null;
  let lastFix: LocationFix | null = null;
  let lastRejection: LocationFixRejection | null = null;

  /**
   * Recent fixes, so a reading that arrives late lands where it was measured.
   *
   * Board readings used to be stamped with whatever fix was current when they
   * arrived, which was right only because they arrived within milliseconds. A
   * reading repaired after a dropout can be minutes old, and stamping it with
   * the current position would pile a whole stretch of road onto the single
   * point where the link came back.
   *
   * Bounded at roughly ten minutes of fixes at 1 Hz, comfortably more than the
   * repair window the stream reader waits through.
   */
  const fixHistory: LocationFix[] = [];
  const maxFixHistory = 600;

  /** The fix nearest in time to `atMs`, or the newest one if there is none. */
  function fixAt(atMs: number | null): LocationFix | null {
    if (atMs === null || fixHistory.length === 0) {
      return lastFix;
    }

    let best = fixHistory[fixHistory.length - 1];
    let bestDistance = Math.abs(best.timestamp - atMs);

    // Newest first: a live reading matches on the first comparison, and the
    // walk only runs long for the late arrivals that need it.
    for (let index = fixHistory.length - 2; index >= 0; index -= 1) {
      const distance = Math.abs(fixHistory[index].timestamp - atMs);

      if (distance >= bestDistance) {
        // Fixes are in time order, so once the gap starts growing again
        // nothing earlier can be nearer.
        break;
      }

      best = fixHistory[index];
      bestDistance = distance;
    }

    return best;
  }

  function flush() {
    return activeBuffer?.buffer.flush() ?? 0;
  }

  function bufferFor(rideId: string) {
    if (activeBuffer && activeBuffer.rideId !== rideId) {
      activeBuffer.buffer.flush();
      activeBuffer = null;
    }

    if (!activeBuffer) {
      activeBuffer = {
        rideId,
        buffer: createSampleBuffer((samples) => {
          store.insertSamples(rideId, samples);
        }, bufferOptions),
      };
    }

    return activeBuffer.buffer;
  }

  function snapshotFor(
    active: ActiveRecording,
    progress: RideProgress
  ): RecordingSnapshot {
    return {
      rideId: active.rideId,
      sensorSource: active.sensorSource,
      startedAt: active.startedAt,
      metrics: summarizeRideProgress(progress, { startedAt: active.startedAt }),
      lastFix: progress.lastFix,
      lastRejection,
      bufferedSamples: activeBuffer?.buffer.size() ?? 0,
    };
  }

  function publish(snapshot: RecordingSnapshot | null) {
    listeners.forEach((listener) => listener(snapshot));
  }

  return {
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    /** Begin a recording. The ride row must already exist. */
    begin(recording) {
      // Write anything a previous ride left waiting rather than dropping it on
      // the floor: those samples are already counted in that ride's distance.
      flush();

      lastRejection = null;
      activeBuffer = null;
      fixHistory.length = 0;

      const progress = store.getRideProgress(recording.rideId);

      // Resuming after a restart: carry on from where the route left off, so
      // the next fix is filtered against the last one rather than treated as
      // the start of a new route.
      lastFix = progress.lastFix;
      bufferFor(recording.rideId);
      publish(snapshotFor(recording, progress));
    },

    /**
     * Fold a batch of fixes into the active ride.
     *
     * Fixes arrive in batches: `expo-location` hands over everything the OS
     * collected since it last woke the app, which after a screen lock can be
     * several at once.
     */
    recordLocationFixes(fixes) {
      const active = store.getActiveRecording();

      if (!active) {
        return null;
      }

      const folded = foldLocationFixes(store.getRideProgress(active.rideId), fixes);

      lastRejection = folded.lastRejection;
      store.saveRideProgress(active.rideId, folded.progress);
      lastFix = folded.progress.lastFix;

      for (const fix of fixes) {
        fixHistory.push(fix);
      }

      if (fixHistory.length > maxFixHistory) {
        fixHistory.splice(0, fixHistory.length - maxFixHistory);
      }

      if (folded.samples.length > 0) {
        bufferFor(active.rideId).add(folded.samples);
      }

      const snapshot = snapshotFor(active, folded.progress);

      publish(snapshot);

      return snapshot;
    },

    /**
     * Record a vibration reading from the XIAO board.
     *
     * The board measures far faster than GPS updates, so each reading is
     * stamped with the fix nearest it in time. `locationAgeMs` says how far
     * apart the two were, which is what later lets a reading be tied to a
     * place with a known confidence.
     *
     * `recordedAt` is when the board measured it, which is not always when it
     * arrived: a reading repaired after a dropout carries the board's own
     * timestamp, and that is what decides where on the route it belongs.
     */
    recordExternalSample(reading, recordedAt = Date.now()) {
      const active = store.getActiveRecording();

      if (!active) {
        return;
      }

      bufferFor(active.rideId).add([
        sampleFromImuReading(reading, fixAt(recordedAt), recordedAt),
      ]);
    },

    /**
     * End the current segment, keeping the ride open.
     *
     * Pausing stops location updates, so the next fix after a resume can be
     * anywhere — a rider who paused to take a train has not skated the line
     * between the two points. Clearing the last fix and the anchor makes that
     * fix start a fresh segment, so neither the distance nor the moving clock
     * is credited for a stretch that was never recorded.
     *
     * The totals banked so far are untouched: this ends a segment, not a ride.
     */
    breakSegment() {
      const active = store.getActiveRecording();

      if (!active) {
        return null;
      }

      // Waiting samples belong to the stretch that just ended, so they are
      // written before the seam rather than carried across it.
      flush();

      const progress = store.getRideProgress(active.rideId);
      const broken = {
        ...progress,
        lastFix: null,
        anchorFix: null,
        pendingSeconds: 0,
      };

      store.saveRideProgress(active.rideId, broken);
      lastFix = null;
      lastRejection = null;

      const snapshot = snapshotFor(active, broken);

      publish(snapshot);

      return snapshot;
    },

    /** Write anything the buffer is still holding. */
    flush,

    getSnapshot() {
      const active = store.getActiveRecording();

      if (!active) {
        return null;
      }

      return snapshotFor(active, store.getRideProgress(active.rideId));
    },

    /**
     * Close the ride out.
     *
     * The buffer is written before the ride is finished, so every sample
     * operation is queued ahead of the finish operation. The backend refuses
     * samples for a finished ride, and the queue is sent in order, so getting
     * this backwards would strand the tail of every ride.
     */
    end(endedAt = Date.now()) {
      const active = store.getActiveRecording();

      if (!active) {
        return null;
      }

      flush();

      const progress = store.getRideProgress(active.rideId);
      const metrics = summarizeRideProgress(progress, {
        startedAt: active.startedAt,
        endedAt,
      });

      store.finishRide(active.rideId, endedAt, {
        distanceMeters: metrics.distanceMeters,
        movingSeconds: metrics.movingSeconds,
        maxSpeedMps: metrics.maxSpeedMps,
      });
      store.clearActiveRecording();

      activeBuffer = null;
      lastFix = null;
      fixHistory.length = 0;
      lastRejection = null;
      publish(null);

      return {
        rideId: active.rideId,
        metrics,
      };
    },
  };
}
