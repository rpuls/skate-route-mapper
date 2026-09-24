// Ride tracking maths shared by the mobile recorder and the backend.
//
// Two jobs live here, and both have to give the same answer on both sides:
//
//   1. Deciding whether a GPS fix is trustworthy enough to keep.
//   2. Turning a stream of kept fixes into distance, moving time and speed.
//
// The fix filter is a TypeScript port of `shouldAcceptLocation()` from
// `mobile/modules/background-recorder/.../BackgroundRecorderService.kt`, which
// was the only place in the project that rejected bad fixes. Moving recording
// onto `expo-location` would have thrown that logic away, so it lives here
// instead, where both platforms and the backend can use it.
//
// Nothing in this module touches a platform API, a clock or a database. It is
// pure so it can be unit tested, and so the phone and the server can agree on
// what a ride's distance is.

export const locationProviders = ["gps", "network", "unknown"] as const;

export type LocationProvider = (typeof locationProviders)[number];

/**
 * One position report, normalised away from any platform's location object.
 *
 * `timestamp` is the moment the fix describes, not the moment it was handed to
 * the app: a batched background delivery can arrive seconds late, and using the
 * delivery time would smear the route.
 */
export type LocationFix = {
  latitude: number;
  longitude: number;
  timestamp: number;
  /** Horizontal accuracy in metres. `null` when the platform did not report one. */
  accuracy: number | null;
  /** Ground speed in m/s. `null`, or a negative value, means "not reported". */
  speed: number | null;
  /**
   * Which sensor produced the fix, where the platform says. iOS does not expose
   * this, and `expo-location` does not surface it on Android either, so it is
   * usually `"unknown"` — see `accuracy-downgrade` below for what stands in.
   */
  provider?: LocationProvider | undefined;
};

export const locationFixRejections = [
  "out-of-range",
  "missing-accuracy",
  "poor-accuracy",
  "provider-downgrade",
  "accuracy-downgrade",
  "implied-teleport",
  "out-of-order",
] as const;

export type LocationFixRejection = (typeof locationFixRejections)[number];

export type LocationFixDecision =
  | { accepted: true }
  | { accepted: false; rejection: LocationFixRejection };

export type LocationFilterOptions = {
  /** Fixes vaguer than this are never useful for a route. */
  maxAcceptedAccuracyMeters: number;
  /**
   * A teleport guard, not a speed limit. Anything under this could be a genuine
   * fast fix, so the jump is only rejected when the fix is also imprecise.
   */
  maxReasonableSpeedMps: number;
  /** A jump above `maxReasonableSpeedMps` is kept if the fix is at least this precise. */
  strictJumpAccuracyMeters: number;
  /** How much worse a downgraded fix has to be before it is dropped. */
  accuracyDowngradeFactor: number;
  /** Accuracy at or below which a fix is treated as satellite-grade. */
  gpsGradeAccuracyMeters: number;
  /**
   * How long a good fix keeps the right to reject a worse one. Past this, the
   * filter stops being picky rather than stranding a rider with no route.
   */
  accuracyDowngradeWindowMs: number;
};

export type RideProgressOptions = LocationFilterOptions & {
  /** Below this, movement is treated as standing still. */
  movingSpeedThresholdMps: number;
  /** A single fix interval never credits more moving time than this. */
  maxMovingGapSeconds: number;
  /** Past this gap the route is considered lost, and the missing stretch is not guessed at. */
  maxSegmentGapSeconds: number;
  /** Distance is only banked once the rider has moved at least this far. */
  minSegmentMeters: number;
  /**
   * Movement required per metre of position uncertainty, when the platform
   * does not report a speed and noise is the only thing to go on.
   */
  accuracyJitterFactor: number;
  /** Segments implying a faster speed than this are not real skating. */
  maxPlausibleSpeedMps: number;
};

/**
 * Defaults are tuned for skating: a few m/s, fixes every couple of seconds.
 *
 * The first four come from the Kotlin service and are deliberately unchanged,
 * so Android keeps behaving the way it already did.
 */
export const rideTrackingDefaults: Readonly<RideProgressOptions> = Object.freeze({
  maxAcceptedAccuracyMeters: 50,
  maxReasonableSpeedMps: 666.6,
  strictJumpAccuracyMeters: 10,
  accuracyDowngradeFactor: 1.5,
  gpsGradeAccuracyMeters: 15,
  accuracyDowngradeWindowMs: 30_000,
  movingSpeedThresholdMps: 0.5,
  maxMovingGapSeconds: 10,
  maxSegmentGapSeconds: 30,
  minSegmentMeters: 2,
  accuracyJitterFactor: 1,
  maxPlausibleSpeedMps: 35,
});

const earthRadiusMeters = 6_371_008.8;

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in metres. */
export function haversineMeters(from: LocationFix, to: LocationFix) {
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);
  const deltaLat = toLat - fromLat;
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A reported speed is only usable when it is finite and not the "unknown" sentinel. */
export function usableSpeed(speed: number | null | undefined) {
  if (speed === null || speed === undefined || !Number.isFinite(speed) || speed < 0) {
    return null;
  }

  return speed;
}

function hasUsableCoordinates(fix: LocationFix) {
  return (
    Number.isFinite(fix.latitude) &&
    Number.isFinite(fix.longitude) &&
    Number.isFinite(fix.timestamp) &&
    fix.latitude >= -90 &&
    fix.latitude <= 90 &&
    fix.longitude >= -180 &&
    fix.longitude <= 180
  );
}

function usableAccuracy(fix: LocationFix) {
  if (fix.accuracy === null || fix.accuracy === undefined) {
    return null;
  }

  return Number.isFinite(fix.accuracy) && fix.accuracy >= 0 ? fix.accuracy : null;
}

/**
 * Decide whether `fix` is trustworthy enough to extend the route that ends at
 * `previous`.
 *
 * Ported rules, in the order the Kotlin service applied them:
 *
 * - `out-of-range` — the coordinates or timestamp are not real numbers.
 * - `missing-accuracy` — the platform could not say how good the fix is.
 * - `poor-accuracy` — the fix is vaguer than `maxAcceptedAccuracyMeters`.
 * - `provider-downgrade` — a satellite fix is followed by a markedly worse
 *   non-satellite one. This is what stops wifi and cell-tower fixes from
 *   dragging a route sideways.
 * - `implied-teleport` — the jump since the last fix is impossible *and* the
 *   fix is imprecise. Both halves matter: the speed bound alone would discard
 *   genuine fast fixes.
 *
 * Two rules are new, and deliberately so:
 *
 * - `accuracy-downgrade` stands in for `provider-downgrade` on platforms that
 *   do not report a provider, which is all of them once recording runs through
 *   `expo-location`. It applies the same "much worse than the good fix we just
 *   had" test to accuracy alone, and only while the good fix is recent, so a
 *   rider skating into a built-up area is not left with no route at all.
 * - `out-of-order` drops fixes older than the one already kept. Background
 *   location arrives in batches, and a late straggler would otherwise walk the
 *   route backwards.
 */
export function evaluateLocationFix(
  previous: LocationFix | null,
  fix: LocationFix,
  options: Partial<LocationFilterOptions> = {}
): LocationFixDecision {
  const settings = { ...rideTrackingDefaults, ...options };

  if (!hasUsableCoordinates(fix)) {
    return { accepted: false, rejection: "out-of-range" };
  }

  const accuracy = usableAccuracy(fix);

  if (accuracy === null) {
    return { accepted: false, rejection: "missing-accuracy" };
  }

  if (accuracy > settings.maxAcceptedAccuracyMeters) {
    return { accepted: false, rejection: "poor-accuracy" };
  }

  if (previous === null) {
    return { accepted: true };
  }

  if (fix.timestamp < previous.timestamp) {
    return { accepted: false, rejection: "out-of-order" };
  }

  const previousAccuracy = usableAccuracy(previous);
  const elapsedMs = fix.timestamp - previous.timestamp;
  const withinDowngradeWindow = elapsedMs <= settings.accuracyDowngradeWindowMs;

  if (previousAccuracy !== null && withinDowngradeWindow) {
    const muchWorse = accuracy > previousAccuracy * settings.accuracyDowngradeFactor;

    if (
      muchWorse &&
      previous.provider === "gps" &&
      fix.provider !== undefined &&
      fix.provider !== "gps"
    ) {
      return { accepted: false, rejection: "provider-downgrade" };
    }

    if (
      muchWorse &&
      previousAccuracy <= settings.gpsGradeAccuracyMeters &&
      accuracy > settings.gpsGradeAccuracyMeters
    ) {
      return { accepted: false, rejection: "accuracy-downgrade" };
    }
  }

  const elapsedSeconds = elapsedMs / 1000;

  if (elapsedSeconds > 0) {
    const impliedSpeed = haversineMeters(previous, fix) / elapsedSeconds;

    if (
      impliedSpeed > settings.maxReasonableSpeedMps &&
      accuracy > settings.strictJumpAccuracyMeters
    ) {
      return { accepted: false, rejection: "implied-teleport" };
    }
  }

  return { accepted: true };
}

/**
 * Everything needed to keep accumulating a ride, including across an app
 * restart. It is plain JSON so it can be written to SQLite as it stands.
 *
 * `anchorFix` is separate from `lastFix` on purpose. Distance is measured from
 * the anchor, and the anchor only moves once the rider has actually covered
 * ground — that is what stops a phone sitting still from logging kilometres of
 * GPS jitter, without losing the distance of someone moving slowly.
 */
export type RideProgress = {
  distanceMeters: number;
  movingSeconds: number;
  maxSpeedMps: number;
  acceptedFixCount: number;
  rejectedFixCount: number;
  firstFixAt: number | null;
  lastFixAt: number | null;
  lastFix: LocationFix | null;
  anchorFix: LocationFix | null;
  /**
   * Time banked since the anchor last moved, waiting to be counted as moving
   * time or thrown away. Time is credited on the same evidence as distance —
   * the anchor actually advancing — so a phone that only jitters can neither
   * log metres nor run the clock.
   */
  pendingSeconds: number;
};

export type RideMetrics = {
  distanceMeters: number;
  movingSeconds: number;
  elapsedSeconds: number;
  /** Distance over moving time: the figure a tracker shows as "average speed". */
  avgSpeedMps: number;
  maxSpeedMps: number;
  acceptedFixCount: number;
  rejectedFixCount: number;
};

export function createRideProgress(): RideProgress {
  return {
    distanceMeters: 0,
    movingSeconds: 0,
    maxSpeedMps: 0,
    acceptedFixCount: 0,
    rejectedFixCount: 0,
    firstFixAt: null,
    lastFixAt: null,
    lastFix: null,
    anchorFix: null,
    pendingSeconds: 0,
  };
}

/**
 * How far apart two fixes have to be before the difference is movement rather
 * than noise.
 *
 * When the platform reports a speed and that speed says the rider is moving,
 * noise is not the risk and only the small floor applies — which keeps the
 * route faithful around corners, because the anchor advances on nearly every
 * fix instead of cutting across several.
 *
 * With no reported speed there is nothing but the positions to go on, so
 * movement smaller than the position uncertainty is not believed: with a 20 m
 * fix, a 3 m step means nothing.
 */
function jitterThreshold(
  from: LocationFix,
  to: LocationFix,
  settings: RideProgressOptions,
  trustedMoving: boolean
) {
  if (trustedMoving) {
    return settings.minSegmentMeters;
  }

  const uncertainty = Math.max(usableAccuracy(from) ?? 0, usableAccuracy(to) ?? 0);

  return Math.max(settings.minSegmentMeters, uncertainty * settings.accuracyJitterFactor);
}

export type RideProgressStep = {
  progress: RideProgress;
  decision: LocationFixDecision;
  /** Metres banked by this fix. Zero when the fix was too close to the anchor to trust. */
  segmentMeters: number;
};

/**
 * Fold one fix into a ride's running totals.
 *
 * Returns a new progress object; the input is not modified, so a caller can
 * keep the previous value if it decides not to commit the step.
 */
export function advanceRideProgress(
  progress: RideProgress,
  fix: LocationFix,
  options: Partial<RideProgressOptions> = {}
): RideProgressStep {
  const settings = { ...rideTrackingDefaults, ...options };
  const decision = evaluateLocationFix(progress.lastFix, fix, settings);

  if (!decision.accepted) {
    return {
      progress: {
        ...progress,
        rejectedFixCount: progress.rejectedFixCount + 1,
      },
      decision,
      segmentMeters: 0,
    };
  }

  const previous = progress.lastFix;
  const anchor = progress.anchorFix;
  const reportedSpeed = usableSpeed(fix.speed);

  // A reported speed is Doppler-derived and reads near zero when standing
  // still, so it is the most direct evidence there is about whether the rider
  // is moving. Where it exists, it decides; where it does not, position noise
  // has to be ruled out instead.
  const stationary =
    reportedSpeed !== null && reportedSpeed < settings.movingSpeedThresholdMps;
  const trustedMoving =
    reportedSpeed !== null && reportedSpeed >= settings.movingSpeedThresholdMps;

  let distanceMeters = progress.distanceMeters;
  let movingSeconds = progress.movingSeconds;
  let maxSpeedMps = progress.maxSpeedMps;
  let pendingSeconds = progress.pendingSeconds;
  let nextAnchor = anchor ?? fix;
  let segmentMeters = 0;

  // Bank the elapsed time first, so an anchor that advances on this fix can
  // claim the whole stretch it covered, not just the last interval. A rider
  // moving slowly crosses the jitter floor only every few fixes, and all of
  // those seconds were spent moving.
  //
  // Time banked while stationary would be credited in full the moment the
  // rider set off again, turning a ten minute coffee stop into ten minutes of
  // skating. The cap bounds the same mistake where no speed is reported and
  // only the anchor can tell.
  if (previous !== null && !stationary) {
    const gapSeconds = (fix.timestamp - previous.timestamp) / 1000;

    if (gapSeconds > 0 && gapSeconds <= settings.maxSegmentGapSeconds) {
      pendingSeconds = Math.min(
        pendingSeconds + Math.min(gapSeconds, settings.maxMovingGapSeconds),
        settings.maxSegmentGapSeconds
      );
    }
  }

  if (anchor !== null) {
    const anchorGapSeconds = (fix.timestamp - anchor.timestamp) / 1000;
    const anchorDistance = haversineMeters(anchor, fix);

    if (anchorGapSeconds > settings.maxSegmentGapSeconds) {
      // The route was lost for too long to guess what happened in between.
      // Restart from here rather than drawing a straight line across the gap,
      // and do not claim the blackout as time spent skating.
      nextAnchor = fix;
      pendingSeconds = 0;
    } else if (
      // Holding the anchor where the rider stopped means their drift never
      // accumulates, and the real displacement is measured from the resting
      // point once they move off again.
      !stationary &&
      anchorDistance >= jitterThreshold(anchor, fix, settings, trustedMoving)
    ) {
      const anchorSpeed = anchorGapSeconds > 0 ? anchorDistance / anchorGapSeconds : 0;

      if (anchorSpeed <= settings.maxPlausibleSpeedMps) {
        distanceMeters += anchorDistance;
        segmentMeters = anchorDistance;

        if (anchorSpeed >= settings.movingSpeedThresholdMps) {
          movingSeconds += pendingSeconds;
        }

        // Without a reported speed, the anchor stretch is the only speed
        // measurement that is not dominated by position noise.
        if (reportedSpeed === null) {
          maxSpeedMps = Math.max(maxSpeedMps, anchorSpeed);
        }
      }

      nextAnchor = fix;
      pendingSeconds = 0;
    }
  }

  if (reportedSpeed !== null && reportedSpeed <= settings.maxPlausibleSpeedMps) {
    maxSpeedMps = Math.max(maxSpeedMps, reportedSpeed);
  }

  return {
    progress: {
      distanceMeters,
      movingSeconds,
      maxSpeedMps,
      acceptedFixCount: progress.acceptedFixCount + 1,
      rejectedFixCount: progress.rejectedFixCount,
      firstFixAt: progress.firstFixAt ?? fix.timestamp,
      lastFixAt: fix.timestamp,
      lastFix: fix,
      anchorFix: nextAnchor,
      pendingSeconds,
    },
    decision,
    segmentMeters,
  };
}

/** Fold a whole list of fixes, for a backfill or a server-side recompute. */
export function rideProgressFromFixes(
  fixes: readonly LocationFix[],
  options: Partial<RideProgressOptions> = {}
): RideProgress {
  return fixes.reduce(
    (progress, fix) => advanceRideProgress(progress, fix, options).progress,
    createRideProgress()
  );
}

/**
 * Close out a ride's running totals into the numbers a rider sees.
 *
 * `elapsedSeconds` prefers the ride's own start and end when the caller knows
 * them, because a ride's wall-clock length includes the stretch before the
 * first fix arrived.
 */
export function summarizeRideProgress(
  progress: RideProgress,
  bounds: { startedAt?: number | null; endedAt?: number | null } = {}
): RideMetrics {
  const startedAt = bounds.startedAt ?? progress.firstFixAt;
  const endedAt = bounds.endedAt ?? progress.lastFixAt;
  const elapsedSeconds =
    startedAt !== null && startedAt !== undefined && endedAt !== null && endedAt !== undefined
      ? Math.max(0, (endedAt - startedAt) / 1000)
      : 0;

  return {
    distanceMeters: progress.distanceMeters,
    movingSeconds: progress.movingSeconds,
    elapsedSeconds,
    avgSpeedMps:
      progress.movingSeconds > 0 ? progress.distanceMeters / progress.movingSeconds : 0,
    maxSpeedMps: progress.maxSpeedMps,
    acceptedFixCount: progress.acceptedFixCount,
    rejectedFixCount: progress.rejectedFixCount,
  };
}

/** A sample carrying enough of a fix to be tracked. Matches `MeasurementSample`. */
export type LocatedSample = {
  timestamp: number;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  locationTimestamp?: number | null | undefined;
  locationAccuracy?: number | null | undefined;
};

/**
 * Pull the fixes out of a ride's samples.
 *
 * A XIAO ride interleaves vibration samples that carry no position, so most
 * rows are skipped. `locationTimestamp` wins over the sample's own timestamp:
 * a vibration sample stamped with a copy of the last known fix would otherwise
 * look like a fresh fix at a new time.
 */
export function locationFixesFromSamples(
  samples: readonly LocatedSample[]
): LocationFix[] {
  const fixes: LocationFix[] = [];
  let lastFixTimestamp: number | null = null;

  for (const sample of samples) {
    if (sample.latitude === null || sample.longitude === null) {
      continue;
    }

    const timestamp = sample.locationTimestamp ?? sample.timestamp;

    if (lastFixTimestamp !== null && timestamp === lastFixTimestamp) {
      continue;
    }

    lastFixTimestamp = timestamp;
    fixes.push({
      latitude: sample.latitude,
      longitude: sample.longitude,
      timestamp,
      accuracy: sample.locationAccuracy ?? null,
      speed: sample.speed,
    });
  }

  return fixes;
}

/** Recompute a ride's metrics from its stored samples. */
export function rideMetricsFromSamples(
  samples: readonly LocatedSample[],
  bounds: { startedAt?: number | null; endedAt?: number | null } = {},
  options: Partial<RideProgressOptions> = {}
): RideMetrics {
  return summarizeRideProgress(
    rideProgressFromFixes(locationFixesFromSamples(samples), options),
    bounds
  );
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseLocationFix(value: unknown): LocationFix | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.latitude !== "number" ||
    typeof candidate.longitude !== "number" ||
    typeof candidate.timestamp !== "number"
  ) {
    return null;
  }

  const provider = candidate.provider;
  const knownProvider = locationProviders.includes(provider as LocationProvider)
    ? (provider as LocationProvider)
    : null;

  return {
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    timestamp: candidate.timestamp,
    accuracy: typeof candidate.accuracy === "number" ? candidate.accuracy : null,
    speed: typeof candidate.speed === "number" ? candidate.speed : null,
    // Left off entirely rather than set to undefined, so a fix that survives a
    // round trip through storage still compares equal to the one written.
    ...(knownProvider === null ? {} : { provider: knownProvider }),
  };
}

/**
 * Read progress back from storage.
 *
 * Anything unrecognised becomes a fresh ride rather than an exception: a
 * recording in flight must never be lost to a parse error.
 */
export function parseRideProgress(value: unknown): RideProgress {
  if (typeof value !== "object" || value === null) {
    return createRideProgress();
  }

  const candidate = value as Record<string, unknown>;

  return {
    distanceMeters: Math.max(0, finiteNumber(candidate.distanceMeters, 0)),
    movingSeconds: Math.max(0, finiteNumber(candidate.movingSeconds, 0)),
    maxSpeedMps: Math.max(0, finiteNumber(candidate.maxSpeedMps, 0)),
    acceptedFixCount: Math.max(0, finiteNumber(candidate.acceptedFixCount, 0)),
    rejectedFixCount: Math.max(0, finiteNumber(candidate.rejectedFixCount, 0)),
    firstFixAt: typeof candidate.firstFixAt === "number" ? candidate.firstFixAt : null,
    lastFixAt: typeof candidate.lastFixAt === "number" ? candidate.lastFixAt : null,
    lastFix: parseLocationFix(candidate.lastFix),
    anchorFix: parseLocationFix(candidate.anchorFix),
    pendingSeconds: Math.max(0, finiteNumber(candidate.pendingSeconds, 0)),
  };
}

const metersPerKilometer = 1000;

/** `3.4 km` / `840 m`. Distances below a kilometre read better in metres. */
export function formatDistance(meters: number) {
  if (!Number.isFinite(meters) || meters < 0) {
    return "0 m";
  }

  if (meters < metersPerKilometer) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / metersPerKilometer).toFixed(2)} km`;
}

/** `1:04:09` once past an hour, `4:09` below it. */
export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  const paddedSeconds = String(remainder).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
}

/** Riders read km/h, the sensors report m/s. */
export function metersPerSecondToKmh(speed: number) {
  return Number.isFinite(speed) ? speed * 3.6 : 0;
}

export function formatSpeedKmh(speed: number | null) {
  if (speed === null || !Number.isFinite(speed) || speed < 0) {
    return "--";
  }

  return `${metersPerSecondToKmh(speed).toFixed(1)} km/h`;
}
