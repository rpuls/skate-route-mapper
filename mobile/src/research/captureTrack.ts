import { create } from "zustand";
import * as Location from "expo-location";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  formatSpeedKmh,
  rideProgressFromFixes,
  summarizeRideProgress,
  usableSpeed,
  type LocationFix,
} from "@skate-route-mapper/shared/rideTracking";
import type {
  ResearchTrack,
  ResearchTrackFix,
  ResearchTrackSpeed,
} from "../types/research";

/**
 * The phone's record of what the rider was doing while the board recorded.
 *
 * A research collection used to carry two positions: one taken standing still
 * before the board was told to start, and one taken when the file was
 * retrieved — which is after the recording ended and after a transfer that can
 * run for minutes. Neither says anything about how fast the rider was moving
 * over the stretch the accelerometer measured, and speed is the first thing
 * roughness has to be normalised for: the same asphalt reads rougher at 20 km/h
 * than at 8, so two runs cannot be compared without it.
 *
 * So the phone logs its own fixes for exactly the capture window, and the
 * window is the point. Fixes from the transfer afterwards are a rider standing
 * still reading a progress bar; averaging those in would flatten every figure
 * the capture is judged by.
 *
 * It lives at module scope rather than in the research screen, for the same
 * reason the board link does: a rider who opens the drawer mid-capture must not
 * silently lose the track.
 */

/**
 * A fix closer than this to the one before it is dropped.
 *
 * One a second is what the hardware actually resolves, and it is plenty to
 * normalise a 10 to 60 second run for speed. Android will happily deliver
 * bursts faster than the requested interval, and every fix has to fit in the
 * recording header, so the log is thinned here rather than trusted to the
 * platform.
 */
const minFixSpacingMs = 750;

/**
 * Hard ceiling on logged fixes.
 *
 * The track travels inside the `.skateresearch` header, which the shared codec
 * refuses above 64 kB, and a fix costs about 128 bytes of it. The longest
 * capture can legitimately produce around 84 fixes, so this is a wide margin
 * against a platform that ignores every interval it was asked for while still
 * leaving the header well inside the limit.
 */
const maxFixes = 300;

/**
 * How long past the requested duration the log stays open.
 *
 * The board is told to record after the log is started and finishes on its own
 * clock, so the window is closed a little late rather than a little early: a
 * missing last second costs evidence, a spare one costs nothing.
 */
const graceSeconds = 3;

const keepAwakeTag = "skate-research-capture";

type CaptureTrackState = {
  /** True while fixes are being collected for a capture. */
  logging: boolean;
  /**
   * The board capture this log belongs to, once the board has answered with it.
   *
   * Kept so a track can never be attached to the wrong recording. A board found
   * already finished — a leftover from a previous session, say — is retrieved
   * without this screen having started a log at all, and the last log taken must
   * not be saved as if it described that capture.
   */
  captureId: number | null;
  startedAt: number | null;
  endedAt: number | null;
  fixCount: number;
  /** Ground speed of the most recent fix, in m/s, or null if it reported none. */
  latestSpeedMps: number | null;
  /** Horizontal accuracy of the most recent fix, in metres. */
  latestAccuracyMeters: number | null;
  /** Set when the window closes, so the screen can show what was logged. */
  summary: ResearchTrackSpeed | null;
  /** Why the track is thin or missing, when it is. */
  error: string | null;
};

const idleState: CaptureTrackState = {
  logging: false,
  captureId: null,
  startedAt: null,
  endedAt: null,
  fixCount: 0,
  latestSpeedMps: null,
  latestAccuracyMeters: null,
  summary: null,
  error: null,
};

export const useCaptureTrack = create<CaptureTrackState>(() => ({ ...idleState }));

// The fixes themselves stay out of the store: they are written once a second
// and read once, at save time, and putting a growing array through a React
// subscription would re-render the screen for nothing.
let fixes: ResearchTrackFix[] = [];
let subscription: Location.LocationSubscription | null = null;
let autoStopTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start logging for a capture of `durationSeconds`.
 *
 * Called just before the board is told to record, so the first fix is already
 * in hand when sampling begins. Location permission has been asked for by the
 * time this runs — the screen takes a context fix first — so a refusal surfaces
 * as the watch failing, which is reported rather than thrown: a capture is
 * still worth having without a track.
 */
export async function startCaptureTrack(durationSeconds: number) {
  resetCaptureTrack();

  useCaptureTrack.setState({ ...idleState, logging: true, startedAt: Date.now() });

  // `watchPositionAsync` is a foreground subscription, and a capture is short
  // enough that the phone auto-locking halfway through would take most of the
  // track with it. The ride recorder's background task is deliberately not
  // reused: it writes into whatever ride is open, and a research capture is not
  // a ride.
  void activateKeepAwakeAsync(keepAwakeTag).catch(() => {});

  try {
    subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 0,
      },
      recordLocation
    );
  } catch (error) {
    useCaptureTrack.setState({
      logging: false,
      error:
        error instanceof Error
          ? `GPS could not be logged for this capture: ${error.message}`
          : "GPS could not be logged for this capture.",
    });

    return false;
  }

  autoStopTimer = setTimeout(
    () => stopCaptureTrack(),
    (durationSeconds + graceSeconds) * 1000
  );

  return true;
}

/**
 * Close the window and work out what it says.
 *
 * Idempotent: the screen closes it when the board reports the capture finished,
 * and the timer closes it if the board never answers because BLE dropped.
 */
export function stopCaptureTrack() {
  if (autoStopTimer !== null) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }

  if (subscription !== null) {
    subscription.remove();
    subscription = null;
  }

  void deactivateKeepAwake(keepAwakeTag).catch(() => {});

  const state = useCaptureTrack.getState();

  if (!state.logging) {
    return;
  }

  useCaptureTrack.setState({
    logging: false,
    endedAt: Date.now(),
    summary: summarizeTrackFixes(fixes),
    error:
      state.error ??
      (fixes.length === 0
        ? "No GPS fixes arrived during this capture, so it carries no speed."
        : null),
  });
}

/** The board capture this log turned out to belong to. */
export function noteCaptureId(captureId: number) {
  useCaptureTrack.setState({ captureId });
}

/**
 * Everything logged for one board capture, ready to be saved with it.
 *
 * Null when this log describes some other capture, or none: a collection with
 * no track is honest, one carrying another run's speeds is not.
 */
export function takeCaptureTrack(captureId: number): ResearchTrack | null {
  const state = useCaptureTrack.getState();

  if (state.startedAt === null || state.captureId !== captureId) {
    return null;
  }

  return {
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    fixes,
    speed: state.summary ?? summarizeTrackFixes(fixes),
    error: state.error,
  };
}

export function resetCaptureTrack() {
  stopCaptureTrack();
  fixes = [];
  useCaptureTrack.setState({ ...idleState });
}

function recordLocation(location: Location.LocationObject) {
  if (
    !Number.isFinite(location.coords.latitude) ||
    !Number.isFinite(location.coords.longitude) ||
    !Number.isFinite(location.timestamp) ||
    fixes.length >= maxFixes
  ) {
    return;
  }

  const previous = fixes[fixes.length - 1];

  if (previous !== undefined && location.timestamp - previous.t < minFixSpacingMs) {
    return;
  }

  const fix = trackFixFromLocation(location);

  fixes.push(fix);
  useCaptureTrack.setState({
    fixCount: fixes.length,
    latestSpeedMps: usableSpeed(fix.speed),
    latestAccuracyMeters: fix.accuracy,
  });
}

function trackFixFromLocation(location: Location.LocationObject): ResearchTrackFix {
  return {
    t: Math.round(location.timestamp),
    // Seven decimals is about a centimetre. Past that the digits are float
    // noise, and they would be paid for in header bytes.
    latitude: rounded(location.coords.latitude, 7) ?? 0,
    longitude: rounded(location.coords.longitude, 7) ?? 0,
    accuracy: rounded(location.coords.accuracy, 2),
    altitude: rounded(location.coords.altitude, 2),
    speed: rounded(location.coords.speed, 3),
    heading: rounded(location.coords.heading, 1),
  };
}

/**
 * The speed evidence for a capture window.
 *
 * The distance-based half runs the fixes through the same filter and maths a
 * ride uses, so a research figure and a ride figure mean the same thing.
 */
export function summarizeTrackFixes(
  trackFixes: readonly ResearchTrackFix[]
): ResearchTrackSpeed {
  const reported = trackFixes
    .map((fix) => usableSpeed(fix.speed))
    .filter((speed): speed is number => speed !== null)
    .sort((left, right) => left - right);
  const metrics = summarizeRideProgress(
    rideProgressFromFixes(trackFixes.map(locationFixFromTrackFix))
  );
  const accuracies = trackFixes
    .map((fix) => fix.accuracy)
    .filter((value): value is number => value !== null);

  return {
    fixCount: trackFixes.length,
    acceptedFixCount: metrics.acceptedFixCount,
    rejectedFixCount: metrics.rejectedFixCount,
    reportedFixCount: reported.length,
    reportedMeanMps: rounded(mean(reported), 3),
    reportedMedianMps: rounded(median(reported), 3),
    reportedMinMps: rounded(reported[0], 3),
    reportedMaxMps: rounded(reported[reported.length - 1], 3),
    distanceMeters: rounded(metrics.distanceMeters, 1) ?? 0,
    movingSeconds: rounded(metrics.movingSeconds, 1) ?? 0,
    avgSpeedMps: rounded(metrics.avgSpeedMps, 3) ?? 0,
    maxSpeedMps: rounded(metrics.maxSpeedMps, 3) ?? 0,
    worstAccuracyMeters: accuracies.length ? rounded(Math.max(...accuracies), 2) : null,
  };
}

/** One line of speed for a screen: what it was, and how well it is known. */
export function describeTrackSpeed(speed: ResearchTrackSpeed | null | undefined) {
  if (!speed || speed.fixCount === 0) {
    return "No GPS speed logged";
  }

  const average =
    speed.reportedFixCount > 0
      ? `${formatSpeedKmh(speed.reportedMeanMps)} average`
      : `${formatSpeedKmh(speed.avgSpeedMps)} average from positions`;
  const peak = formatSpeedKmh(
    speed.reportedFixCount > 0 ? speed.reportedMaxMps : speed.maxSpeedMps
  );

  return `${average} · ${peak} peak · ${speed.fixCount} fix${
    speed.fixCount === 1 ? "" : "es"
  }`;
}

function locationFixFromTrackFix(fix: ResearchTrackFix): LocationFix {
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    timestamp: fix.t,
    accuracy: fix.accuracy,
    speed: fix.speed,
  };
}

function mean(values: readonly number[]) {
  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: readonly number[]) {
  if (values.length === 0) {
    return null;
  }

  const middle = values.length >> 1;

  return values.length % 2 === 1
    ? values[middle] ?? null
    : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

function rounded(value: number | null | undefined, decimals: number) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Number(value.toFixed(decimals));
}
