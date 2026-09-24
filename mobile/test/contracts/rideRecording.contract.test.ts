import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  maxSamplesPerSyncOperation,
  type SyncOperation,
} from "@skate-route-mapper/shared/mobileContracts";
import {
  createRideProgress,
  type LocationFix,
} from "@skate-route-mapper/shared/rideTracking";
import type { MeasurementSample } from "../../src/types/measurement.js";
import {
  foldLocationFixes,
  sampleFromFix,
  sampleFromImuReading,
} from "../../src/recording/recordingSamples.js";
import { createSampleBuffer } from "../../src/recording/sampleBuffer.js";
import { backoffDelayMs, nextAttemptAt, syncBackoffDefaults } from "../../src/sync/backoff.js";
import {
  operationsPerRequest,
  sampleCountOf,
  samplesPerRequest,
  selectSendableOperations,
  takeRequestBatch,
  type QueuedOperation,
} from "../../src/sync/syncBatching.js";

const originLatitude = 55.6761;
const originLongitude = 12.5683;
const metersPerLatitudeDegree = (Math.PI / 180) * 6_371_008.8;

function fixAt(params: {
  northMeters?: number;
  atMs: number;
  accuracy?: number | null;
  speed?: number | null;
}): LocationFix {
  return {
    latitude: originLatitude + (params.northMeters ?? 0) / metersPerLatitudeDegree,
    longitude: originLongitude,
    timestamp: params.atMs,
    accuracy: params.accuracy === undefined ? 5 : params.accuracy,
    speed: params.speed === undefined ? null : params.speed,
  };
}

function samplesOperation(
  id: string,
  sampleCount: number,
  rideId = "ride"
): SyncOperation {
  return {
    operationId: id,
    type: "ride.samples",
    createdAt: 0,
    payload: {
      rideId,
      samples: Array.from({ length: sampleCount }, () => ({
        timestamp: 0,
        ax: null,
        ay: null,
        az: null,
        gx: null,
        gy: null,
        gz: null,
        vibrationMagnitude: null,
        latitude: null,
        longitude: null,
        speed: null,
      })),
    },
  };
}

function finishOperation(id: string, rideId = "ride"): SyncOperation {
  return {
    operationId: id,
    type: "ride.finish",
    createdAt: 0,
    payload: { rideId, endedAt: 0 },
  };
}

function queued(operation: SyncOperation, nextAttemptAt: number): QueuedOperation {
  return { ...operation, nextAttemptAt };
}

describe("sample rows", () => {
  it("records a GPS fix with no motion data rather than zeroes", () => {
    const sample = sampleFromFix(fixAt({ atMs: 1000, accuracy: 6, speed: 4.2 }));

    assert.equal(sample.ax, null);
    assert.equal(sample.ay, null);
    assert.equal(sample.az, null);
    assert.equal(sample.gx, null);
    assert.equal(sample.gy, null);
    assert.equal(sample.gz, null);
    assert.equal(sample.vibrationMagnitude, null);
    assert.equal(sample.speed, 4.2);
    assert.equal(sample.locationAccuracy, 6);
    assert.equal(sample.timestamp, 1000);
    assert.equal(sample.locationTimestamp, 1000);
    // The sample is the fix, so its position is not stale. Recording delivery
    // latency here would get backgrounded fixes hidden from the route map.
    assert.equal(sample.locationAgeMs, 0);
  });

  it("does not record a speed the platform said it did not know", () => {
    const sample = sampleFromFix(fixAt({ atMs: 1000, speed: -1 }));

    assert.equal(sample.speed, null);
  });

  it("stamps a board reading with the last known fix and its age", () => {
    const fix = fixAt({ atMs: 1000, accuracy: 7, speed: 3 });
    const sample = sampleFromImuReading(
      { ax: 0.3, ay: 0.4, az: 0, gx: 0.01, gy: 0.02, gz: 0.03 },
      fix,
      2500
    );

    assert.equal(sample.timestamp, 2500);
    assert.equal(sample.vibrationMagnitude, 0.5);
    assert.equal(sample.latitude, fix.latitude);
    assert.equal(sample.locationTimestamp, 1000);
    assert.equal(sample.locationAgeMs, 1500);
    assert.equal(sample.locationAccuracy, 7);
  });

  it("records a board reading taken before any fix arrived", () => {
    const sample = sampleFromImuReading(
      { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 },
      null,
      2500
    );

    assert.equal(sample.latitude, null);
    assert.equal(sample.longitude, null);
    assert.equal(sample.locationAgeMs, null);
    assert.equal(sample.vibrationMagnitude, 1);
  });
});

describe("folding a delivery of fixes", () => {
  it("turns each accepted fix into one sample", () => {
    const folded = foldLocationFixes(
      createRideProgress(),
      [
        fixAt({ atMs: 0 }),
        fixAt({ northMeters: 8, atMs: 2000 }),
        fixAt({ northMeters: 16, atMs: 4000 }),
      ]
    );

    assert.equal(folded.samples.length, 3);
    assert.equal(folded.progress.acceptedFixCount, 3);
    assert.equal(folded.lastRejection, null);
    assert.ok(folded.progress.distanceMeters > 15);
  });

  it("keeps a rejected fix out of the samples and says why", () => {
    const folded = foldLocationFixes(
      createRideProgress(),
      [fixAt({ atMs: 0, accuracy: 5 }), fixAt({ northMeters: 400, atMs: 2000, accuracy: 90 })]
    );

    assert.equal(folded.samples.length, 1);
    assert.equal(folded.progress.rejectedFixCount, 1);
    assert.equal(folded.lastRejection, "poor-accuracy");
  });

  it("clears the rejection once a good fix arrives again", () => {
    const folded = foldLocationFixes(
      createRideProgress(),
      [
        fixAt({ atMs: 0, accuracy: 5 }),
        fixAt({ northMeters: 400, atMs: 2000, accuracy: 90 }),
        fixAt({ northMeters: 12, atMs: 4000, accuracy: 5 }),
      ]
    );

    assert.equal(folded.lastRejection, null);
    assert.equal(folded.samples.length, 2);
  });

  it("carries on from progress restored after a restart", () => {
    const first = foldLocationFixes(
      createRideProgress(),
      [fixAt({ atMs: 0 }), fixAt({ northMeters: 10, atMs: 2000 })]
    );
    const second = foldLocationFixes(
      first.progress,
      [fixAt({ northMeters: 20, atMs: 4000 })]
    );

    assert.equal(second.progress.acceptedFixCount, 3);
    assert.ok(second.progress.distanceMeters > 19);
  });

  it("does nothing with an empty delivery", () => {
    const progress = createRideProgress();
    const folded = foldLocationFixes(progress, []);

    assert.equal(folded.samples.length, 0);
    assert.deepEqual(folded.progress, progress);
  });
});

describe("sample buffering", () => {
  function sample(timestamp: number): MeasurementSample {
    return {
      timestamp,
      ax: null,
      ay: null,
      az: null,
      gx: null,
      gy: null,
      gz: null,
      vibrationMagnitude: null,
      latitude: null,
      longitude: null,
      speed: null,
    };
  }

  it("holds samples back until there are enough to be worth writing", () => {
    const writes: MeasurementSample[][] = [];
    const buffer = createSampleBuffer((samples) => writes.push(samples), {
      maxSamples: 5,
      maxAgeMs: 60_000,
      now: () => 0,
    });

    for (let index = 0; index < 4; index += 1) {
      buffer.add([sample(index)]);
    }

    assert.equal(writes.length, 0);
    assert.equal(buffer.size(), 4);

    buffer.add([sample(4)]);

    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.length, 5);
    assert.equal(buffer.size(), 0);
  });

  it("writes a slow trickle once it has waited long enough", () => {
    const writes: MeasurementSample[][] = [];
    let clock = 0;
    const buffer = createSampleBuffer((samples) => writes.push(samples), {
      maxSamples: 100,
      maxAgeMs: 20_000,
      now: () => clock,
    });

    buffer.add([sample(0)]);
    clock = 10_000;
    buffer.add([sample(1)]);

    assert.equal(writes.length, 0);

    clock = 20_000;
    buffer.add([sample(2)]);

    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.length, 3);
  });

  it("splits a delivery too large for one operation", () => {
    const writes: MeasurementSample[][] = [];
    const buffer = createSampleBuffer((samples) => writes.push(samples), {
      maxSamples: 10,
      maxAgeMs: 60_000,
      now: () => 0,
    });

    buffer.add(Array.from({ length: 25 }, (_unused, index) => sample(index)));

    assert.deepEqual(writes.map((write) => write.length), [10, 10]);
    assert.equal(buffer.size(), 5);
  });

  it("never builds a batch the API would refuse", () => {
    const writes: MeasurementSample[][] = [];
    const buffer = createSampleBuffer((samples) => writes.push(samples), {
      maxSamples: maxSamplesPerSyncOperation * 4,
      maxAgeMs: 60_000,
      now: () => 0,
    });

    buffer.add(
      Array.from({ length: maxSamplesPerSyncOperation * 2 }, (_unused, index) =>
        sample(index)
      )
    );

    assert.ok(writes.length >= 2);
    writes.forEach((write) => {
      assert.ok(write.length <= maxSamplesPerSyncOperation);
    });
  });

  it("writes whatever is left when a ride ends", () => {
    const writes: MeasurementSample[][] = [];
    const buffer = createSampleBuffer((samples) => writes.push(samples), {
      maxSamples: 100,
      maxAgeMs: 60_000,
      now: () => 0,
    });

    buffer.add([sample(0), sample(1)]);

    assert.equal(buffer.flush(), 2);
    assert.equal(writes.length, 1);
    assert.equal(buffer.size(), 0);
    assert.equal(buffer.flush(), 0);
    assert.equal(writes.length, 1);
  });

  it("ignores an empty delivery", () => {
    const writes: MeasurementSample[][] = [];
    const buffer = createSampleBuffer((samples) => writes.push(samples), {
      now: () => 0,
    });

    buffer.add([]);

    assert.equal(writes.length, 0);
    assert.equal(buffer.oldestAt(), null);
  });
});

describe("sync request batching", () => {
  it("keeps a request inside the sample budget", () => {
    const batch = takeRequestBatch([
      samplesOperation("a", 900),
      samplesOperation("b", 900),
      samplesOperation("c", 900),
    ]);

    assert.deepEqual(
      batch.map((operation) => operation.operationId),
      ["a", "b"]
    );
    assert.ok(
      batch.reduce((total, operation) => total + sampleCountOf(operation), 0) <=
        samplesPerRequest
    );
  });

  it("keeps a request inside the operation budget", () => {
    const pending = Array.from({ length: operationsPerRequest + 10 }, (_unused, index) =>
      finishOperation(`op-${index}`)
    );

    assert.equal(takeRequestBatch(pending).length, operationsPerRequest);
  });

  it("sends a single oversized operation rather than stalling on it", () => {
    const batch = takeRequestBatch([samplesOperation("huge", samplesPerRequest + 500)]);

    assert.equal(batch.length, 1);
  });

  it("never reorders the queue", () => {
    const pending = [
      samplesOperation("samples-1", 10),
      samplesOperation("samples-2", 10),
      finishOperation("finish"),
    ];

    assert.deepEqual(
      takeRequestBatch(pending).map((operation) => operation.operationId),
      ["samples-1", "samples-2", "finish"]
    );
  });

  it("returns nothing for an empty queue", () => {
    assert.deepEqual(takeRequestBatch([]), []);
  });
});

describe("choosing what may be sent", () => {
  const now = 1_000_000;

  it("sends everything that is due", () => {
    const sendable = selectSendableOperations(
      [
        queued(samplesOperation("a", 10), 0),
        queued(samplesOperation("b", 10), now - 1),
        queued(finishOperation("c"), now),
      ],
      now
    );

    assert.deepEqual(
      sendable.map((operation) => operation.operationId),
      ["a", "b", "c"]
    );
  });

  it("holds a ride's later operations back behind one that is waiting", () => {
    // The backend refuses samples for a finished ride, so letting the finish
    // past its own stuck samples would reject the end of the ride for good.
    const sendable = selectSendableOperations(
      [
        queued(samplesOperation("samples-1", 10), 0),
        queued(samplesOperation("samples-2", 10), now + 30_000),
        queued(samplesOperation("samples-3", 10), 0),
        queued(finishOperation("finish"), 0),
      ],
      now
    );

    assert.deepEqual(
      sendable.map((operation) => operation.operationId),
      ["samples-1"]
    );
  });

  it("lets other rides through while one is stuck", () => {
    const sendable = selectSendableOperations(
      [
        queued(samplesOperation("stuck", 10, "ride-a"), now + 30_000),
        queued(finishOperation("blocked", "ride-a"), 0),
        queued(samplesOperation("other", 10, "ride-b"), 0),
        queued(finishOperation("other-finish", "ride-b"), 0),
      ],
      now
    );

    assert.deepEqual(
      sendable.map((operation) => operation.operationId),
      ["other", "other-finish"]
    );
  });

  it("releases a ride once its wait is over", () => {
    const stuck = [
      queued(samplesOperation("samples-1", 10), now + 5_000),
      queued(finishOperation("finish"), 0),
    ];

    assert.equal(selectSendableOperations(stuck, now).length, 0);
    assert.equal(selectSendableOperations(stuck, now + 5_000).length, 2);
  });

  it("returns nothing for an empty queue", () => {
    assert.deepEqual(selectSendableOperations([], now), []);
  });
});

describe("retry backoff", () => {
  const noJitter = { random: () => 0 };

  it("doubles the wait with each failed attempt", () => {
    assert.equal(backoffDelayMs(1, noJitter), syncBackoffDefaults.baseDelayMs);
    assert.equal(backoffDelayMs(2, noJitter), syncBackoffDefaults.baseDelayMs * 2);
    assert.equal(backoffDelayMs(3, noJitter), syncBackoffDefaults.baseDelayMs * 4);
  });

  it("stops growing at the ceiling", () => {
    assert.equal(backoffDelayMs(50, noJitter), syncBackoffDefaults.maxDelayMs);
    assert.equal(backoffDelayMs(1000, noJitter), syncBackoffDefaults.maxDelayMs);
    assert.ok(Number.isFinite(backoffDelayMs(Number.MAX_SAFE_INTEGER, noJitter)));
  });

  it("treats a first failure as one attempt however it is counted", () => {
    assert.equal(backoffDelayMs(0, noJitter), syncBackoffDefaults.baseDelayMs);
    assert.equal(backoffDelayMs(-5, noJitter), syncBackoffDefaults.baseDelayMs);
  });

  it("spreads retries out so a fleet of phones does not return at once", () => {
    const earliest = backoffDelayMs(3, { random: () => 0 });
    const latest = backoffDelayMs(3, { random: () => 1 });

    assert.ok(latest > earliest);
    assert.equal(latest, Math.round(earliest * (1 + syncBackoffDefaults.jitterRatio)));
  });

  it("schedules the retry from the moment it failed", () => {
    assert.equal(
      nextAttemptAt(1, 1_000_000, noJitter),
      1_000_000 + syncBackoffDefaults.baseDelayMs
    );
  });
});
