import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceRideProgress,
  createRideProgress,
  evaluateLocationFix,
  formatDistance,
  formatDuration,
  formatSpeedKmh,
  haversineMeters,
  locationFixesFromSamples,
  parseRideProgress,
  rideMetricsFromSamples,
  rideProgressFromFixes,
  rideTrackingDefaults,
  summarizeRideProgress,
  usableSpeed,
  type LocationFix,
} from "../../../shared/src/rideTracking.js";

// Copenhagen, where the board is being ridden.
const originLatitude = 55.6761;
const originLongitude = 12.5683;

// One degree of latitude on the sphere this module uses.
const metersPerLatitudeDegree = (Math.PI / 180) * 6_371_008.8;

function fixAt(params: {
  northMeters?: number;
  eastMeters?: number;
  atMs: number;
  accuracy?: number | null;
  speed?: number | null;
  provider?: "gps" | "network" | "unknown";
}): LocationFix {
  const north = params.northMeters ?? 0;
  const east = params.eastMeters ?? 0;
  const latitude = originLatitude + north / metersPerLatitudeDegree;
  const longitude =
    originLongitude +
    east / (metersPerLatitudeDegree * Math.cos((latitude * Math.PI) / 180));

  return {
    latitude,
    longitude,
    timestamp: params.atMs,
    accuracy: params.accuracy === undefined ? 5 : params.accuracy,
    speed: params.speed === undefined ? null : params.speed,
    ...(params.provider ? { provider: params.provider } : {}),
  };
}

function assertClose(actual: number, expected: number, tolerance: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, got ${actual}`
  );
}

function rejection(decision: ReturnType<typeof evaluateLocationFix>) {
  return decision.accepted ? "accepted" : decision.rejection;
}

describe("ride tracking distance maths", () => {
  it("measures zero distance between a fix and itself", () => {
    const fix = fixAt({ atMs: 0 });

    assert.equal(haversineMeters(fix, fix), 0);
  });

  it("measures a degree of latitude against the sphere it documents", () => {
    const south = fixAt({ atMs: 0 });
    const north: LocationFix = { ...south, latitude: south.latitude + 1 };

    assertClose(haversineMeters(south, north), metersPerLatitudeDegree, 0.5, "one degree");
  });

  it("is symmetric", () => {
    const left = fixAt({ atMs: 0 });
    const right = fixAt({ atMs: 0, northMeters: 120, eastMeters: -85 });

    assertClose(
      haversineMeters(left, right),
      haversineMeters(right, left),
      1e-9,
      "symmetry"
    );
  });

  it("shrinks a degree of longitude by the latitude's cosine", () => {
    const west = fixAt({ atMs: 0 });
    const east: LocationFix = { ...west, longitude: west.longitude + 1 };
    const expected = metersPerLatitudeDegree * Math.cos((originLatitude * Math.PI) / 180);

    assertClose(haversineMeters(west, east), expected, 5, "one degree of longitude");
  });

  it("builds test fixes at the offsets they claim", () => {
    const origin = fixAt({ atMs: 0 });

    assertClose(
      haversineMeters(origin, fixAt({ atMs: 0, northMeters: 100 })),
      100,
      0.1,
      "north offset"
    );
    assertClose(
      haversineMeters(origin, fixAt({ atMs: 0, eastMeters: 100 })),
      100,
      0.1,
      "east offset"
    );
  });
});

describe("location fix filter", () => {
  it("accepts a clean first fix", () => {
    assert.equal(rejection(evaluateLocationFix(null, fixAt({ atMs: 0 }))), "accepted");
  });

  it("rejects coordinates outside the world", () => {
    const base = fixAt({ atMs: 0 });

    assert.equal(
      rejection(evaluateLocationFix(null, { ...base, latitude: 91 })),
      "out-of-range"
    );
    assert.equal(
      rejection(evaluateLocationFix(null, { ...base, longitude: -181 })),
      "out-of-range"
    );
    assert.equal(
      rejection(evaluateLocationFix(null, { ...base, latitude: Number.NaN })),
      "out-of-range"
    );
    assert.equal(
      rejection(evaluateLocationFix(null, { ...base, timestamp: Number.NaN })),
      "out-of-range"
    );
  });

  it("rejects a fix with no accuracy, as the Android service did", () => {
    assert.equal(
      rejection(evaluateLocationFix(null, fixAt({ atMs: 0, accuracy: null }))),
      "missing-accuracy"
    );
  });

  it("rejects a fix vaguer than the accepted accuracy, and keeps one exactly at it", () => {
    const limit = rideTrackingDefaults.maxAcceptedAccuracyMeters;

    assert.equal(
      rejection(evaluateLocationFix(null, fixAt({ atMs: 0, accuracy: limit + 0.1 }))),
      "poor-accuracy"
    );
    assert.equal(
      rejection(evaluateLocationFix(null, fixAt({ atMs: 0, accuracy: limit }))),
      "accepted"
    );
  });

  it("rejects a satellite fix followed by a markedly worse network fix", () => {
    // Both accuracies are past satellite grade, so only the provider rule can
    // explain the rejection.
    const previous = fixAt({ atMs: 0, accuracy: 20, provider: "gps" });
    const next = fixAt({ atMs: 2000, northMeters: 5, accuracy: 40, provider: "network" });

    assert.equal(rejection(evaluateLocationFix(previous, next)), "provider-downgrade");
  });

  it("keeps a worse fix when it came from the same provider", () => {
    const previous = fixAt({ atMs: 0, accuracy: 20, provider: "gps" });
    const next = fixAt({ atMs: 2000, northMeters: 5, accuracy: 40, provider: "gps" });

    assert.equal(rejection(evaluateLocationFix(previous, next)), "accepted");
  });

  it("rejects a sharp accuracy collapse when no provider is reported", () => {
    const previous = fixAt({ atMs: 0, accuracy: 6 });
    const next = fixAt({ atMs: 2000, northMeters: 5, accuracy: 30 });

    assert.equal(rejection(evaluateLocationFix(previous, next)), "accuracy-downgrade");
  });

  it("tolerates accuracy drifting within satellite grade", () => {
    const previous = fixAt({ atMs: 0, accuracy: 8 });

    assert.equal(
      rejection(evaluateLocationFix(previous, fixAt({ atMs: 2000, accuracy: 11 }))),
      "accepted"
    );
    assert.equal(
      rejection(evaluateLocationFix(previous, fixAt({ atMs: 2000, accuracy: 15 }))),
      "accepted"
    );
  });

  it("stops being picky once the good fix is stale, rather than stranding the route", () => {
    const previous = fixAt({ atMs: 0, accuracy: 6 });
    const stale = rideTrackingDefaults.accuracyDowngradeWindowMs + 1000;

    assert.equal(
      rejection(evaluateLocationFix(previous, fixAt({ atMs: stale, accuracy: 30 }))),
      "accepted"
    );
  });

  it("rejects an impossible jump only when the fix is also imprecise", () => {
    // The previous fix is already past satellite grade, so the accuracy rules
    // stay out of the way and only the teleport guard can fire.
    const previous = fixAt({ atMs: 0, accuracy: 20 });
    const teleport = { atMs: 1000, northMeters: 1_000_000 };

    assert.equal(
      rejection(evaluateLocationFix(previous, fixAt({ ...teleport, accuracy: 25 }))),
      "implied-teleport"
    );
    // A precise fix is believed even when it implies an absurd speed: the speed
    // bound is a teleport guard, not a skating speed limit.
    assert.equal(
      rejection(evaluateLocationFix(previous, fixAt({ ...teleport, accuracy: 8 }))),
      "accepted"
    );
  });

  it("rejects a straggler that is older than the fix already kept", () => {
    const previous = fixAt({ atMs: 10_000 });

    assert.equal(
      rejection(evaluateLocationFix(previous, fixAt({ atMs: 9_000 }))),
      "out-of-order"
    );
    assert.equal(
      rejection(evaluateLocationFix(previous, fixAt({ atMs: 10_000 }))),
      "accepted"
    );
  });

  it("reads an unknown speed sentinel as no speed at all", () => {
    assert.equal(usableSpeed(-1), null);
    assert.equal(usableSpeed(null), null);
    assert.equal(usableSpeed(undefined), null);
    assert.equal(usableSpeed(Number.NaN), null);
    assert.equal(usableSpeed(0), 0);
    assert.equal(usableSpeed(4.2), 4.2);
  });
});

describe("ride progress accumulation", () => {
  function straightLine(params: {
    fixes: number;
    metersPerFix: number;
    intervalMs: number;
    accuracy?: number;
    speed?: number | null;
  }) {
    return Array.from({ length: params.fixes }, (_unused, index) =>
      fixAt({
        northMeters: index * params.metersPerFix,
        atMs: index * params.intervalMs,
        accuracy: params.accuracy ?? 5,
        speed: params.speed === undefined ? null : params.speed,
      })
    );
  }

  it("adds up a straight skate", () => {
    const progress = rideProgressFromFixes(
      straightLine({ fixes: 11, metersPerFix: 8, intervalMs: 2000 })
    );
    const metrics = summarizeRideProgress(progress);

    assertClose(metrics.distanceMeters, 80, 0.1, "distance");
    assertClose(metrics.movingSeconds, 20, 0.001, "moving seconds");
    assertClose(metrics.elapsedSeconds, 20, 0.001, "elapsed seconds");
    assertClose(metrics.avgSpeedMps, 4, 0.01, "average speed");
    assertClose(metrics.maxSpeedMps, 4, 0.01, "max speed");
    assert.equal(metrics.acceptedFixCount, 11);
    assert.equal(metrics.rejectedFixCount, 0);
  });

  it("banks nothing for a phone standing still with a poor fix", () => {
    // Twelve fixes drifting inside the uncertainty of an 8 m fix, with no
    // reported speed to give the game away: the classic way a tracker invents
    // kilometres while its owner drinks coffee. Consecutive fixes are up to
    // 4.2 m apart, so a naive per-interval test would call this skating.
    const drift = [0, 1.4, -1.1, 0.9, -1.6, 1.2, -0.7, 1.8, -1.3, 0.6, -1.9, 1.1];
    const fixes = drift.map((offset, index) =>
      fixAt({
        northMeters: offset,
        eastMeters: -offset,
        atMs: index * 1000,
        accuracy: 8,
        speed: null,
      })
    );

    const metrics = summarizeRideProgress(rideProgressFromFixes(fixes));

    assert.equal(metrics.distanceMeters, 0);
    assert.equal(metrics.movingSeconds, 0);
    assert.equal(metrics.maxSpeedMps, 0);
    assert.equal(metrics.acceptedFixCount, fixes.length);
  });

  it("still counts a slow rider whose every step is under the jitter floor", () => {
    // 1.5 m per second with a 10 m fix: every single step sits below the
    // jitter floor, but the anchor holds until the movement is unmistakable.
    const fixes = Array.from({ length: 21 }, (_unused, index) =>
      fixAt({ northMeters: index * 1.5, atMs: index * 1000, accuracy: 10, speed: 1.5 })
    );

    const metrics = summarizeRideProgress(rideProgressFromFixes(fixes));

    assertClose(metrics.distanceMeters, 30, 6, "slow distance");
    assertClose(metrics.movingSeconds, 20, 0.001, "slow moving seconds");
  });

  it("does not draw a straight line across a long GPS blackout", () => {
    const before = straightLine({ fixes: 4, metersPerFix: 10, intervalMs: 2000 });
    const blackoutMs = (rideTrackingDefaults.maxSegmentGapSeconds + 30) * 1000;
    const after = Array.from({ length: 4 }, (_unused, index) =>
      fixAt({
        northMeters: 5000 + index * 10,
        atMs: 6000 + blackoutMs + index * 2000,
      })
    );

    const metrics = summarizeRideProgress(rideProgressFromFixes([...before, ...after]));

    // 30 m before the blackout and 30 m after it; the 5 km hole is not counted,
    // and neither is the blackout's worth of moving time.
    assertClose(metrics.distanceMeters, 60, 0.2, "distance around a blackout");
    assertClose(metrics.movingSeconds, 12, 0.001, "moving seconds around a blackout");
  });

  it("caps the moving time a single long interval can claim", () => {
    const fixes = [
      fixAt({ atMs: 0, speed: 5 }),
      fixAt({ northMeters: 100, atMs: 20_000, speed: 5 }),
    ];

    const metrics = summarizeRideProgress(rideProgressFromFixes(fixes));

    assertClose(
      metrics.movingSeconds,
      rideTrackingDefaults.maxMovingGapSeconds,
      0.001,
      "capped moving seconds"
    );
    assertClose(metrics.distanceMeters, 100, 0.2, "distance over a long interval");
  });

  it("does not hand a rider ten minutes of skating for a coffee stop", () => {
    // Without a gate, seconds banked while parked are credited in full the
    // moment the anchor next advances.
    const skating = Array.from({ length: 6 }, (_unused, index) =>
      fixAt({ northMeters: index * 8, atMs: index * 2000, speed: 4 })
    );
    const parked = Array.from({ length: 300 }, (_unused, index) =>
      fixAt({ northMeters: 40, atMs: 10_000 + (index + 1) * 2000, speed: 0 })
    );
    const onwards = Array.from({ length: 5 }, (_unused, index) =>
      fixAt({ northMeters: 40 + (index + 1) * 8, atMs: 612_000 + index * 2000, speed: 4 })
    );

    const metrics = summarizeRideProgress(
      rideProgressFromFixes([...skating, ...parked, ...onwards])
    );

    // Ten seconds before the stop and eight after it; the ten minute stop
    // itself is not skating.
    assertClose(metrics.movingSeconds, 18, 0.001, "moving seconds across a long stop");
  });

  it("keeps the anchor where the rider stopped, so their drift is not distance", () => {
    // Twenty minutes of jitter at a standstill, reported as stationary.
    const drift = Array.from({ length: 60 }, (_unused, index) =>
      fixAt({
        northMeters: index % 2 === 0 ? 6 : -6,
        eastMeters: index % 3 === 0 ? 6 : -6,
        atMs: index * 2000,
        accuracy: 5,
        speed: 0,
      })
    );

    const metrics = summarizeRideProgress(rideProgressFromFixes(drift));

    assert.equal(metrics.distanceMeters, 0);
    assert.equal(metrics.movingSeconds, 0);
    assert.equal(metrics.acceptedFixCount, drift.length);
  });

  it("caps the time one banked stretch can claim when no speed is reported", () => {
    // No reported speed and a 10 m fix, so nothing crosses the jitter floor
    // until the rider has covered ten metres - which takes two minutes here.
    const crawl = Array.from({ length: 61 }, (_unused, index) =>
      fixAt({ northMeters: index * 0.2, atMs: index * 2000, accuracy: 10, speed: null })
    );

    const metrics = summarizeRideProgress(rideProgressFromFixes(crawl));

    assert.ok(
      metrics.movingSeconds <= rideTrackingDefaults.maxSegmentGapSeconds + 0.001,
      `expected the banked stretch to be capped, got ${metrics.movingSeconds}`
    );
  });

  it("follows a reported-moving rider fix by fix, without cutting corners", () => {
    // With the platform confirming movement, position noise is not the risk, so
    // short steps are believed and the route keeps its shape.
    const steps = Array.from({ length: 21 }, (_unused, index) =>
      fixAt({ northMeters: index * 3, atMs: index * 1000, accuracy: 12, speed: 3 })
    );

    const progress = rideProgressFromFixes(steps);

    assertClose(progress.distanceMeters, 60, 0.2, "distance with a reported speed");
    // Every fix moved the anchor, rather than several being banked as one
    // straight line across a curve.
    assertClose(summarizeRideProgress(progress).movingSeconds, 20, 0.001, "moving seconds");
  });

  it("pauses the clock when the rider stops", () => {
    const skating = Array.from({ length: 6 }, (_unused, index) =>
      fixAt({ northMeters: index * 8, atMs: index * 2000, speed: 4 })
    );
    const resting = Array.from({ length: 6 }, (_unused, index) =>
      fixAt({ northMeters: 40, atMs: 10_000 + (index + 1) * 2000, speed: 0 })
    );

    const metrics = summarizeRideProgress(rideProgressFromFixes([...skating, ...resting]));

    assertClose(metrics.movingSeconds, 10, 0.001, "moving seconds excluding the rest");
    assertClose(metrics.elapsedSeconds, 22, 0.001, "elapsed seconds including the rest");
    assertClose(metrics.distanceMeters, 40, 0.2, "distance");
  });

  it("prefers the reported speed for the top-speed figure", () => {
    const fixes = [
      fixAt({ atMs: 0, speed: 3 }),
      fixAt({ northMeters: 10, atMs: 2000, speed: 9.4 }),
      fixAt({ northMeters: 20, atMs: 4000, speed: 3 }),
    ];

    assertClose(rideProgressFromFixes(fixes).maxSpeedMps, 9.4, 0.001, "max speed");
  });

  it("ignores a top speed no skater reaches", () => {
    const fixes = [
      fixAt({ atMs: 0, speed: 4 }),
      fixAt({ northMeters: 10, atMs: 2000, speed: 250 }),
    ];

    assertClose(rideProgressFromFixes(fixes).maxSpeedMps, 4, 0.001, "clamped max speed");
  });

  it("derives a top speed when the platform reports none", () => {
    const fixes = [
      fixAt({ atMs: 0, speed: null }),
      fixAt({ northMeters: 24, atMs: 2000, speed: null }),
    ];

    assertClose(rideProgressFromFixes(fixes).maxSpeedMps, 12, 0.05, "derived max speed");
  });

  it("refuses distance from a segment implying an impossible skating speed", () => {
    // Precise enough to survive the fix filter, far too fast to be a skate.
    const fixes = [
      fixAt({ atMs: 0, accuracy: 4 }),
      fixAt({ northMeters: 5000, atMs: 1000, accuracy: 4 }),
      fixAt({ northMeters: 5010, atMs: 3000, accuracy: 4 }),
    ];

    const metrics = summarizeRideProgress(rideProgressFromFixes(fixes));

    assertClose(metrics.distanceMeters, 10, 0.2, "distance after an implausible jump");
  });

  it("counts rejected fixes without letting them move the route", () => {
    const good = fixAt({ atMs: 0, accuracy: 5 });
    const bad = fixAt({ northMeters: 400, atMs: 2000, accuracy: 80 });
    const next = fixAt({ northMeters: 10, atMs: 4000, accuracy: 5 });

    const metrics = summarizeRideProgress(rideProgressFromFixes([good, bad, next]));

    assert.equal(metrics.rejectedFixCount, 1);
    assert.equal(metrics.acceptedFixCount, 2);
    assertClose(metrics.distanceMeters, 10, 0.2, "distance ignoring the bad fix");
  });

  it("leaves the input progress untouched", () => {
    const progress = createRideProgress();
    const step = advanceRideProgress(progress, fixAt({ atMs: 0 }));

    assert.equal(progress.acceptedFixCount, 0);
    assert.equal(progress.lastFix, null);
    assert.equal(step.progress.acceptedFixCount, 1);
    assert.notEqual(step.progress, progress);
  });

  it("reports the metres a step banked", () => {
    const first = advanceRideProgress(createRideProgress(), fixAt({ atMs: 0 }));
    const second = advanceRideProgress(
      first.progress,
      fixAt({ northMeters: 12, atMs: 2000 })
    );

    assert.equal(first.segmentMeters, 0);
    assertClose(second.segmentMeters, 12, 0.1, "segment metres");
  });

  it("summarises an empty ride as zeroes rather than NaN", () => {
    const metrics = summarizeRideProgress(createRideProgress());

    assert.deepEqual(metrics, {
      distanceMeters: 0,
      movingSeconds: 0,
      elapsedSeconds: 0,
      avgSpeedMps: 0,
      maxSpeedMps: 0,
      acceptedFixCount: 0,
      rejectedFixCount: 0,
    });
  });

  it("measures elapsed time from the ride's own bounds when they are known", () => {
    const progress = rideProgressFromFixes(
      straightLine({ fixes: 3, metersPerFix: 10, intervalMs: 2000 })
    );
    const metrics = summarizeRideProgress(progress, { startedAt: 0, endedAt: 30_000 });

    // The ride ran for thirty seconds even though the fixes only cover four.
    assertClose(metrics.elapsedSeconds, 30, 0.001, "elapsed from ride bounds");
  });
});

describe("ride progress persistence", () => {
  it("survives a round trip through storage", () => {
    const progress = rideProgressFromFixes([
      fixAt({ atMs: 0, speed: 4 }),
      fixAt({ northMeters: 20, atMs: 2000, speed: 4.5 }),
    ]);

    const restored = parseRideProgress(JSON.parse(JSON.stringify(progress)));

    assert.deepEqual(restored, progress);
  });

  it("keeps recording rather than throwing on unreadable stored progress", () => {
    const fresh = createRideProgress();

    assert.deepEqual(parseRideProgress(null), fresh);
    assert.deepEqual(parseRideProgress("not progress"), fresh);
    assert.deepEqual(parseRideProgress({ distanceMeters: "far" }), fresh);
    assert.deepEqual(parseRideProgress({ distanceMeters: -5 }), fresh);
    assert.deepEqual(parseRideProgress({ lastFix: { latitude: 1 } }), fresh);
  });

  it("can carry on from restored progress", () => {
    const first = rideProgressFromFixes([
      fixAt({ atMs: 0 }),
      fixAt({ northMeters: 20, atMs: 2000 }),
    ]);
    const restored = parseRideProgress(JSON.parse(JSON.stringify(first)));
    const continued = advanceRideProgress(
      restored,
      fixAt({ northMeters: 40, atMs: 4000 })
    ).progress;

    const inOneGo = rideProgressFromFixes([
      fixAt({ atMs: 0 }),
      fixAt({ northMeters: 20, atMs: 2000 }),
      fixAt({ northMeters: 40, atMs: 4000 }),
    ]);

    assertClose(
      continued.distanceMeters,
      inOneGo.distanceMeters,
      0.001,
      "distance across a restart"
    );
    assert.equal(continued.acceptedFixCount, inOneGo.acceptedFixCount);
  });
});

describe("ride metrics from stored samples", () => {
  it("ignores samples that carry no position", () => {
    const fixes = locationFixesFromSamples([
      { timestamp: 0, latitude: null, longitude: null, speed: null },
      {
        timestamp: 1000,
        latitude: originLatitude,
        longitude: originLongitude,
        speed: 3,
        locationAccuracy: 6,
      },
    ]);

    assert.equal(fixes.length, 1);
    assert.equal(fixes[0]?.accuracy, 6);
  });

  it("does not count one fix twice because several samples copied it", () => {
    // A XIAO ride writes vibration samples far faster than GPS updates, and
    // each one carries a copy of the last known fix.
    const samples = Array.from({ length: 40 }, (_unused, index) => ({
      timestamp: index * 50,
      latitude: originLatitude,
      longitude: originLongitude,
      speed: 4,
      locationTimestamp: 900,
      locationAccuracy: 5,
    }));

    assert.equal(locationFixesFromSamples(samples).length, 1);
  });

  it("recomputes a mixed XIAO ride's metrics from its samples", () => {
    const samples: {
      timestamp: number;
      latitude: number | null;
      longitude: number | null;
      speed: number | null;
      locationTimestamp?: number | null;
      locationAccuracy?: number | null;
    }[] = [];

    // Ten GPS fixes two seconds apart, 8 m of travel each, with twenty
    // vibration samples in between carrying a copy of the current fix.
    for (let fixIndex = 0; fixIndex < 10; fixIndex += 1) {
      const fixTime = fixIndex * 2000;
      const latitude = originLatitude + (fixIndex * 8) / metersPerLatitudeDegree;

      for (let vibration = 0; vibration < 20; vibration += 1) {
        samples.push({
          timestamp: fixTime + vibration * 100,
          latitude,
          longitude: originLongitude,
          speed: 4,
          locationTimestamp: fixTime,
          locationAccuracy: 5,
        });
      }
    }

    const metrics = rideMetricsFromSamples(samples, { startedAt: 0, endedAt: 18_000 });

    assertClose(metrics.distanceMeters, 72, 0.2, "recomputed distance");
    assertClose(metrics.movingSeconds, 18, 0.001, "recomputed moving seconds");
    assertClose(metrics.avgSpeedMps, 4, 0.02, "recomputed average speed");
    assert.equal(metrics.acceptedFixCount, 10);
  });

  it("returns zeroes for a ride with no position data at all", () => {
    const metrics = rideMetricsFromSamples([
      { timestamp: 0, latitude: null, longitude: null, speed: null },
    ]);

    assert.equal(metrics.distanceMeters, 0);
    assert.equal(metrics.avgSpeedMps, 0);
  });
});

describe("rider-facing formatting", () => {
  it("shows short rides in metres and long ones in kilometres", () => {
    assert.equal(formatDistance(0), "0 m");
    assert.equal(formatDistance(840.4), "840 m");
    assert.equal(formatDistance(999), "999 m");
    assert.equal(formatDistance(1000), "1.00 km");
    assert.equal(formatDistance(3421), "3.42 km");
    assert.equal(formatDistance(Number.NaN), "0 m");
  });

  it("grows the clock to hours only when it needs to", () => {
    assert.equal(formatDuration(0), "0:00");
    assert.equal(formatDuration(9), "0:09");
    assert.equal(formatDuration(249), "4:09");
    assert.equal(formatDuration(3849), "1:04:09");
    assert.equal(formatDuration(-1), "0:00");
  });

  it("shows speed in the unit a rider reads", () => {
    assert.equal(formatSpeedKmh(0), "0.0 km/h");
    assert.equal(formatSpeedKmh(5), "18.0 km/h");
    assert.equal(formatSpeedKmh(null), "--");
    assert.equal(formatSpeedKmh(-1), "--");
  });
});
