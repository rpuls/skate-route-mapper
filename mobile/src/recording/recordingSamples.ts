import {
  advanceRideProgress,
  usableSpeed,
  type LocationFix,
  type LocationFixRejection,
  type RideProgress,
} from "@skate-route-mapper/shared/rideTracking";
import type { MeasurementSample } from "../types/measurement";

/**
 * Turning fixes and board readings into sample rows.
 *
 * Kept apart from the recorder so it can be tested without a database: the
 * recorder's own job is storage and lifecycle, and this is the part where a
 * quiet mistake would silently mislabel every sample of every ride.
 */

/**
 * A GPS fix as a sample row.
 *
 * Every motion field is null. The phone is a route tracker; vibration is the
 * board's job, and a zero would be a measurement claim rather than an absence.
 *
 * `locationAgeMs` is zero because this sample *is* the fix. The field measures
 * how stale the attached position was when the sample was taken, which only
 * means something for a board reading stamped with an older fix. Recording how
 * long the OS took to hand the batch over would look like staleness and get
 * every backgrounded fix thrown out of the route map.
 */
export function sampleFromFix(fix: LocationFix): MeasurementSample {
  return {
    timestamp: fix.timestamp,
    ax: null,
    ay: null,
    az: null,
    gx: null,
    gy: null,
    gz: null,
    vibrationMagnitude: null,
    latitude: fix.latitude,
    longitude: fix.longitude,
    speed: usableSpeed(fix.speed),
    locationTimestamp: fix.timestamp,
    locationAccuracy: fix.accuracy,
    locationAgeMs: 0,
  };
}

export type ImuReading = {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
};

/**
 * A board reading as a sample row, stamped with wherever the rider last was.
 *
 * The XIAO measures far faster than GPS updates, so a reading carries the last
 * known fix rather than one of its own. `locationAgeMs` records how stale that
 * was, which is what later decides whether a reading can be trusted to belong
 * to a particular stretch of road.
 */
export function sampleFromImuReading(
  reading: ImuReading,
  fix: LocationFix | null,
  recordedAt: number
): MeasurementSample {
  return {
    timestamp: recordedAt,
    ax: reading.ax,
    ay: reading.ay,
    az: reading.az,
    gx: reading.gx,
    gy: reading.gy,
    gz: reading.gz,
    vibrationMagnitude: Math.hypot(reading.ax, reading.ay, reading.az),
    latitude: fix?.latitude ?? null,
    longitude: fix?.longitude ?? null,
    speed: fix ? usableSpeed(fix.speed) : null,
    locationTimestamp: fix?.timestamp ?? null,
    locationAccuracy: fix?.accuracy ?? null,
    locationAgeMs: fix ? Math.max(0, recordedAt - fix.timestamp) : null,
  };
}

export type FoldedFixes = {
  progress: RideProgress;
  samples: MeasurementSample[];
  /** Why the most recent fix was dropped, or null if the last one was kept. */
  lastRejection: LocationFixRejection | null;
};

/**
 * Fold a delivery of fixes into a ride.
 *
 * Fixes arrive in batches: the OS hands over everything it collected since it
 * last woke the app, which after a screen lock can be several at once. Only
 * accepted fixes become samples, so a rejected fix never reaches the route on
 * the phone or the one on the server.
 */
export function foldLocationFixes(
  progress: RideProgress,
  fixes: readonly LocationFix[]
): FoldedFixes {
  let nextProgress = progress;
  const samples: MeasurementSample[] = [];
  let lastRejection: LocationFixRejection | null = null;

  for (const fix of fixes) {
    const step = advanceRideProgress(nextProgress, fix);

    nextProgress = step.progress;

    if (step.decision.accepted) {
      lastRejection = null;
      samples.push(sampleFromFix(fix));
    } else {
      lastRejection = step.decision.rejection;
    }
  }

  return {
    progress: nextProgress,
    samples,
    lastRejection,
  };
}
