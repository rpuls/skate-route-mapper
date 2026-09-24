import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { RideMetricsPayload } from "@skate-route-mapper/shared/mobileContracts";
import {
  createRideProgress,
  type LocationFix,
  type RideProgress,
} from "@skate-route-mapper/shared/rideTracking";
import {
  createRideRecorder,
  type ActiveRecording,
  type RecorderStore,
  type RecordingSnapshot,
} from "../../src/recording/rideRecorder.js";
import type { MeasurementSample } from "../../src/types/measurement.js";

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
    speed: params.speed === undefined ? 4 : params.speed,
  };
}

type Written =
  | { kind: "samples"; rideId: string; samples: MeasurementSample[] }
  | { kind: "finish"; rideId: string; endedAt: number; metrics?: RideMetricsPayload };

/**
 * A storage double that records the order it was written in.
 *
 * Order is the point: the backend refuses samples for a finished ride, so a
 * finish written before the last samples would cost the end of the ride.
 */
function createStoreDouble() {
  let active: ActiveRecording | null = null;
  const progress = new Map<string, RideProgress>();
  const writes: Written[] = [];

  const store: RecorderStore = {
    getActiveRecording: () => active,
    clearActiveRecording: () => {
      active = null;
    },
    getRideProgress: (rideId) => progress.get(rideId) ?? createRideProgress(),
    saveRideProgress: (rideId, next) => {
      progress.set(rideId, next);
    },
    insertSamples: (rideId, samples) => {
      writes.push({ kind: "samples", rideId, samples });
    },
    finishRide: (rideId, endedAt, metrics) => {
      writes.push(
        metrics
          ? { kind: "finish", rideId, endedAt, metrics }
          : { kind: "finish", rideId, endedAt }
      );
    },
  };

  return {
    store,
    writes,
    setActive(recording: ActiveRecording | null) {
      active = recording;
    },
    setProgress(rideId: string, next: RideProgress) {
      progress.set(rideId, next);
    },
    getProgress(rideId: string) {
      return progress.get(rideId) ?? null;
    },
    samplesFor(rideId: string) {
      return writes
        .filter((write): write is Extract<Written, { kind: "samples" }> =>
          write.kind === "samples" && write.rideId === rideId
        )
        .flatMap((write) => write.samples);
    },
  };
}

const ride: ActiveRecording = {
  rideId: "ride-1",
  sensorSource: "phone",
  startedAt: 0,
};

// A buffer that never flushes on its own, so every test says explicitly when
// samples are expected to be written.
const patientBuffer = { maxSamples: 10_000, maxAgeMs: 10 * 60_000 };

describe("ride recorder lifecycle", () => {
  let double: ReturnType<typeof createStoreDouble>;

  beforeEach(() => {
    double = createStoreDouble();
  });

  it("writes buffered samples before finishing the ride", () => {
    const recorder = createRideRecorder(double.store, patientBuffer);

    double.setActive(ride);
    recorder.begin(ride);
    recorder.recordLocationFixes([
      fixAt({ atMs: 0 }),
      fixAt({ northMeters: 8, atMs: 2000 }),
      fixAt({ northMeters: 16, atMs: 4000 }),
    ]);

    assert.equal(double.writes.length, 0, "nothing written while buffering");

    recorder.end(6000);

    assert.deepEqual(
      double.writes.map((write) => write.kind),
      ["samples", "finish"]
    );
  });

  it("reports the ride's measured distance on the finish write", () => {
    const recorder = createRideRecorder(double.store, patientBuffer);

    double.setActive(ride);
    recorder.begin(ride);
    recorder.recordLocationFixes(
      Array.from({ length: 11 }, (_unused, index) =>
        fixAt({ northMeters: index * 8, atMs: index * 2000 })
      )
    );

    const finished = recorder.end(20_000);
    const finish = double.writes.find((write) => write.kind === "finish");

    assert.ok(finished);
    assert.ok(finish && finish.kind === "finish");
    assert.ok(Math.abs((finish.metrics?.distanceMeters ?? 0) - 80) < 0.5);
    assert.equal(finish.metrics?.distanceMeters, finished.metrics.distanceMeters);
    assert.equal(finish.endedAt, 20_000);
  });

  it("stores progress as it goes, so a restart does not lose the ride", () => {
    const recorder = createRideRecorder(double.store, patientBuffer);

    double.setActive(ride);
    recorder.begin(ride);
    recorder.recordLocationFixes([fixAt({ atMs: 0 }), fixAt({ northMeters: 20, atMs: 2000 })]);

    const stored = double.getProgress(ride.rideId);

    assert.ok(stored);
    assert.equal(stored.acceptedFixCount, 2);
    assert.ok(stored.distanceMeters > 19);
  });

  it("carries on from stored progress after the app was restarted", () => {
    const first = createRideRecorder(double.store, patientBuffer);

    double.setActive(ride);
    first.begin(ride);
    first.recordLocationFixes([fixAt({ atMs: 0 }), fixAt({ northMeters: 20, atMs: 2000 })]);

    // A new recorder is what a cold start produces: no memory, only storage.
    const second = createRideRecorder(double.store, patientBuffer);

    second.begin(ride);

    const snapshot = second.recordLocationFixes([fixAt({ northMeters: 40, atMs: 4000 })]);

    assert.equal(snapshot?.metrics.acceptedFixCount, 3);
    assert.ok((snapshot?.metrics.distanceMeters ?? 0) > 39);
  });

  it("filters the first fix after a restart against the one before it", () => {
    const first = createRideRecorder(double.store, patientBuffer);

    double.setActive(ride);
    first.begin(ride);
    first.recordLocationFixes([fixAt({ atMs: 10_000, accuracy: 5 })]);

    const second = createRideRecorder(double.store, patientBuffer);

    second.begin(ride);

    // Older than the fix already kept: without restored progress this would be
    // treated as the start of a fresh route.
    const snapshot = second.recordLocationFixes([fixAt({ atMs: 9_000, accuracy: 5 })]);

    assert.equal(snapshot?.lastRejection, "out-of-order");
    assert.equal(snapshot?.metrics.acceptedFixCount, 1);
  });

  it("does not drop one ride's buffered samples when the next ride begins", () => {
    const recorder = createRideRecorder(double.store, patientBuffer);

    double.setActive(ride);
    recorder.begin(ride);
    recorder.recordLocationFixes([fixAt({ atMs: 0 }), fixAt({ northMeters: 8, atMs: 2000 })]);

    const second: ActiveRecording = {
      rideId: "ride-2",
      sensorSource: "phone",
      startedAt: 100_000,
    };

    double.setActive(second);
    recorder.begin(second);

    assert.equal(double.samplesFor(ride.rideId).length, 2);
  });

  it("records nothing when no ride is active", () => {
    const recorder = createRideRecorder(double.store, patientBuffer);

    double.setActive(null);

    assert.equal(recorder.recordLocationFixes([fixAt({ atMs: 0 })]), null);
    recorder.recordExternalSample({ ax: 1, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 });
    assert.equal(recorder.end(), null);
    assert.equal(recorder.getSnapshot(), null);
    assert.equal(double.writes.length, 0);
  });

  it("stamps board readings with the fix the ride is currently at", () => {
    const recorder = createRideRecorder(double.store, patientBuffer);

    double.setActive({ ...ride, sensorSource: "external" });
    recorder.begin({ ...ride, sensorSource: "external" });
    recorder.recordLocationFixes([fixAt({ northMeters: 24, atMs: 2000, accuracy: 7 })]);
    recorder.recordExternalSample({ ax: 0.3, ay: 0.4, az: 0, gx: 0, gy: 0, gz: 0 }, 2400);
    recorder.flush();

    const board = double
      .samplesFor(ride.rideId)
      .find((sample) => sample.vibrationMagnitude !== null);

    assert.ok(board);
    assert.equal(board.locationTimestamp, 2000);
    assert.equal(board.locationAccuracy, 7);
    assert.equal(board.locationAgeMs, 400);
    assert.ok(Math.abs((board.vibrationMagnitude ?? 0) - 0.5) < 1e-9);
  });

  it("tells subscribers when a ride advances and when it ends", () => {
    const recorder = createRideRecorder(double.store, patientBuffer);
    const seen: (RecordingSnapshot | null)[] = [];

    double.setActive(ride);
    const unsubscribe = recorder.subscribe((snapshot) => seen.push(snapshot));

    recorder.begin(ride);
    recorder.recordLocationFixes([fixAt({ atMs: 0 })]);
    recorder.end(2000);

    assert.equal(seen.length, 3);
    assert.equal(seen[0]?.rideId, ride.rideId);
    assert.equal(seen[1]?.metrics.acceptedFixCount, 1);
    assert.equal(seen[2], null);

    unsubscribe();
    double.setActive(ride);
    recorder.begin(ride);

    assert.equal(seen.length, 3, "an unsubscribed listener stops hearing");
  });

  it("writes samples on its own once enough have arrived", () => {
    const recorder = createRideRecorder(double.store, { maxSamples: 3, maxAgeMs: 60_000 });

    double.setActive(ride);
    recorder.begin(ride);
    recorder.recordLocationFixes(
      Array.from({ length: 7 }, (_unused, index) =>
        fixAt({ northMeters: index * 8, atMs: index * 2000 })
      )
    );

    // Six of the seven written in two batches; the seventh is still waiting.
    assert.deepEqual(
      double.writes
        .filter((write) => write.kind === "samples")
        .map((write) => (write.kind === "samples" ? write.samples.length : 0)),
      [3, 3]
    );
    assert.equal(recorder.getSnapshot()?.bufferedSamples, 1);
  });

  it("clears the active ride so a finished recording cannot be extended", () => {
    const recorder = createRideRecorder(double.store, patientBuffer);

    double.setActive(ride);
    recorder.begin(ride);
    recorder.recordLocationFixes([fixAt({ atMs: 0 })]);
    recorder.end(2000);

    assert.equal(double.store.getActiveRecording(), null);
    assert.equal(recorder.recordLocationFixes([fixAt({ atMs: 4000 })]), null);
  });
});
