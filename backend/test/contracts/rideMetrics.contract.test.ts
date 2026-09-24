import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LocatedSample } from "../../../shared/src/rideTracking.js";
import { rideMetricColumns } from "../../src/features/rides/metrics.js";

const originLatitude = 55.6761;
const originLongitude = 12.5683;
const metersPerLatitudeDegree = (Math.PI / 180) * 6_371_008.8;

function positionSample(params: {
  northMeters: number;
  atMs: number;
  speed?: number | null;
  accuracy?: number | null;
}): LocatedSample {
  return {
    timestamp: params.atMs,
    latitude: originLatitude + params.northMeters / metersPerLatitudeDegree,
    longitude: originLongitude,
    speed: params.speed === undefined ? 4 : params.speed,
    locationTimestamp: params.atMs,
    locationAccuracy: params.accuracy === undefined ? 5 : params.accuracy,
  };
}

const reportedMetrics = {
  distanceMeters: 4218.4,
  movingSeconds: 1042.5,
  maxSpeedMps: 9.2,
};

function assertClose(actual: number, expected: number, tolerance: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, got ${actual}`
  );
}

describe("ride metric columns", () => {
  const skate = Array.from({ length: 11 }, (_unused, index) =>
    positionSample({ northMeters: index * 8, atMs: index * 2000 })
  );

  it("measures the ride from the samples the backend holds", () => {
    const columns = rideMetricColumns({
      samples: skate,
      startedAt: 0,
      endedAt: 20_000,
    });

    assertClose(columns.distanceMeters, 80, 0.2, "distance");
    assertClose(columns.movingSeconds, 20, 0.001, "moving seconds");
    assertClose(columns.avgSpeedMps, 4, 0.02, "average speed");
    assertClose(columns.maxSpeedMps, 4, 0.02, "max speed");
    assert.equal(columns.acceptedFixCount, 11);
    assert.equal(columns.rejectedFixCount, 0);
  });

  it("ignores what the phone reported when it has the route itself", () => {
    const columns = rideMetricColumns({
      samples: skate,
      startedAt: 0,
      endedAt: 20_000,
      reportedMetrics,
    });

    // A client cannot claim a distance the stored samples do not support.
    assertClose(columns.distanceMeters, 80, 0.2, "server distance wins");
    assert.notEqual(columns.maxSpeedMps, reportedMetrics.maxSpeedMps);
  });

  it("falls back to the phone's figures for a ride whose samples never arrived", () => {
    const columns = rideMetricColumns({
      samples: [],
      startedAt: 0,
      endedAt: 20_000,
      reportedMetrics,
    });

    assert.equal(columns.distanceMeters, reportedMetrics.distanceMeters);
    assert.equal(columns.movingSeconds, reportedMetrics.movingSeconds);
    assert.equal(columns.maxSpeedMps, reportedMetrics.maxSpeedMps);
    assertClose(
      columns.avgSpeedMps,
      reportedMetrics.distanceMeters / reportedMetrics.movingSeconds,
      0.001,
      "derived average speed"
    );
    // The server saw no fixes, so it must not claim to have kept any.
    assert.equal(columns.acceptedFixCount, 0);
    assert.equal(columns.rejectedFixCount, 0);
  });

  it("does not divide by zero for a reported ride that never moved", () => {
    const columns = rideMetricColumns({
      samples: [],
      startedAt: 0,
      endedAt: 20_000,
      reportedMetrics: { distanceMeters: 0, movingSeconds: 0, maxSpeedMps: 0 },
    });

    assert.equal(columns.avgSpeedMps, 0);
  });

  it("reports zeroes for a ride with no samples and nothing reported", () => {
    const columns = rideMetricColumns({ samples: [], startedAt: 0, endedAt: 20_000 });

    assert.deepEqual(columns, {
      distanceMeters: 0,
      movingSeconds: 0,
      avgSpeedMps: 0,
      maxSpeedMps: 0,
      acceptedFixCount: 0,
      rejectedFixCount: 0,
    });
  });

  it("keeps a recomputed zero for a ride that stood still, over a reported distance", () => {
    // The phone's figures are a fallback for missing data, not a correction for
    // data the server has. A ride with fixes that did not move really is zero.
    const stationary = Array.from({ length: 6 }, (_unused, index) =>
      positionSample({ northMeters: 0, atMs: index * 2000, speed: 0 })
    );

    const columns = rideMetricColumns({
      samples: stationary,
      startedAt: 0,
      endedAt: 10_000,
      reportedMetrics,
    });

    assert.equal(columns.distanceMeters, 0);
    assert.equal(columns.movingSeconds, 0);
    assert.equal(columns.acceptedFixCount, 6);
  });

  it("skips the vibration samples of a XIAO ride", () => {
    const mixed: LocatedSample[] = [];

    for (let fixIndex = 0; fixIndex < 6; fixIndex += 1) {
      const fixTime = fixIndex * 2000;

      for (let reading = 0; reading < 20; reading += 1) {
        mixed.push({
          timestamp: fixTime + reading * 100,
          latitude: originLatitude + (fixIndex * 8) / metersPerLatitudeDegree,
          longitude: originLongitude,
          speed: 4,
          locationTimestamp: fixTime,
          locationAccuracy: 5,
        });
      }
    }

    const columns = rideMetricColumns({
      samples: mixed,
      startedAt: 0,
      endedAt: 10_000,
    });

    assert.equal(columns.acceptedFixCount, 6);
    assertClose(columns.distanceMeters, 40, 0.2, "distance from a XIAO ride");
  });

  it("measures a ride whose samples carry no usable position at all", () => {
    const columns = rideMetricColumns({
      samples: [
        { timestamp: 0, latitude: null, longitude: null, speed: null },
        { timestamp: 1000, latitude: null, longitude: null, speed: null },
      ],
      startedAt: 0,
      endedAt: 1000,
    });

    assert.equal(columns.distanceMeters, 0);
    assert.equal(columns.acceptedFixCount, 0);
  });
});
