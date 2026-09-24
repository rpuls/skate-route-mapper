import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MeasurementSample } from "@skate-route-mapper/shared/mobileContracts";
import { rideProgressFromFixes } from "@skate-route-mapper/shared/rideTracking";
import {
  clearActiveRecording,
  createRide,
  finishRide,
  getActiveRecording,
  getPendingChangeCount,
  getPendingChangeSummary,
  getPendingRideIds,
  getQueuedChanges,
  getRide,
  getRides,
  getResearchCollections,
  getRideProgress,
  getSamplesForRide,
  initDatabase,
  insertSamples,
  markPendingChangesFailed,
  markPendingChangesSynced,
  resetDatabaseForTests,
  saveResearchCollection,
  saveRideProgress,
  setActiveRecording,
} from "../../src/database/db.web.js";
import type { ResearchCollection } from "../../src/types/research.js";

const rideFixture = {
  id: "mobile-persistence-contract-ride",
  startedAt: 1760000000000,
  vehicleType: "skates",
  sensorSource: "external",
} as const;

const sampleFixtures = [
  {
    timestamp: 1760000001000,
    ax: 0.1,
    ay: -0.2,
    az: 0.97,
    gx: 0.01,
    gy: 0.02,
    gz: 0.03,
    vibrationMagnitude: 0.995,
    latitude: 52.3676,
    longitude: 4.9041,
    speed: 3.5,
    locationTimestamp: 1760000000900,
    locationAccuracy: 12.4,
    locationAgeMs: 100,
  },
  {
    timestamp: 1760000001200,
    ax: 0.11,
    ay: -0.22,
    az: 0.95,
    gx: 0.02,
    gy: 0.01,
    gz: 0.04,
    vibrationMagnitude: 0.981,
    latitude: null,
    longitude: null,
    speed: null,
    locationTimestamp: null,
    locationAccuracy: null,
    locationAgeMs: null,
  },
] satisfies MeasurementSample[];

describe("mobile persistence contract", () => {
  it("round-trips ride and sample fixtures through the local database adapter", () => {
    resetDatabaseForTests();
    initDatabase();

    createRide(rideFixture);
    insertSamples(rideFixture.id, [...sampleFixtures].reverse());
    finishRide(rideFixture.id, 1760000900000, {
      distanceMeters: 1240.5,
      movingSeconds: 305.25,
      maxSpeedMps: 7.8,
    });

    assert.deepEqual(getRide(rideFixture.id), {
      id: rideFixture.id,
      startedAt: rideFixture.startedAt,
      endedAt: 1760000900000,
      vehicleType: rideFixture.vehicleType,
      sensorSource: rideFixture.sensorSource,
      sampleCount: sampleFixtures.length,
      distanceMeters: 0,
      movingSeconds: 0,
      maxSpeedMps: 0,
      acceptedFixCount: 0,
      rejectedFixCount: 0,
    });

    assert.deepEqual(getSamplesForRide(rideFixture.id), sampleFixtures);
    assert.equal(getRides().some((ride) => ride.id === rideFixture.id), true);
    assert.equal(getPendingChangeCount(), 3);
    assert.deepEqual(
      getQueuedChanges().map((change) => change.type),
      ["ride.start", "ride.samples", "ride.finish"]
    );
  });

  it("carries the ride's measured distance on the finish operation", () => {
    resetDatabaseForTests();
    initDatabase();

    createRide(rideFixture);
    finishRide(rideFixture.id, 1760000900000, {
      distanceMeters: 1240.5,
      movingSeconds: 305.25,
      maxSpeedMps: 7.8,
    });

    const finish = getQueuedChanges().find((change) => change.type === "ride.finish");

    assert.equal(finish?.type, "ride.finish");
    assert.deepEqual(finish?.type === "ride.finish" ? finish.payload.metrics : null, {
      distanceMeters: 1240.5,
      movingSeconds: 305.25,
      maxSpeedMps: 7.8,
    });
  });

  it("queues one operation per batch rather than one per sample", () => {
    resetDatabaseForTests();
    initDatabase();
    createRide(rideFixture);

    const batch = Array.from({ length: 200 }, (_unused, index) => ({
      ...sampleFixtures[0],
      timestamp: 1760000001000 + index,
    }));

    insertSamples(rideFixture.id, batch);
    insertSamples(rideFixture.id, batch);

    const sampleOperations = getQueuedChanges(100).filter(
      (change) => change.type === "ride.samples"
    );

    assert.equal(sampleOperations.length, 2);
    assert.equal(getSamplesForRide(rideFixture.id).length, 400);
  });

  it("knows which rides still have something waiting to upload", () => {
    resetDatabaseForTests();
    initDatabase();

    createRide(rideFixture);
    createRide({ ...rideFixture, id: "second-ride" });

    assert.deepEqual(getPendingRideIds().sort(), ["mobile-persistence-contract-ride", "second-ride"]);

    const first = getQueuedChanges().filter(
      (change) => change.payload.rideId === rideFixture.id
    );

    markPendingChangesSynced(
      first.map((change) => ({ operationId: change.operationId, status: "applied" as const }))
    );

    assert.deepEqual(getPendingRideIds(), ["second-ride"]);
  });

  it("stores ride progress and mirrors it onto the ride row", () => {
    resetDatabaseForTests();
    initDatabase();
    createRide(rideFixture);

    const progress = rideProgressFromFixes([
      { latitude: 55.6761, longitude: 12.5683, timestamp: 0, accuracy: 5, speed: 4 },
      { latitude: 55.6771, longitude: 12.5683, timestamp: 30_000, accuracy: 5, speed: 4 },
    ]);

    saveRideProgress(rideFixture.id, progress);

    const stored = getRide(rideFixture.id);

    assert.equal(stored?.acceptedFixCount, 2);
    assert.ok((stored?.distanceMeters ?? 0) > 100);
    assert.deepEqual(getRideProgress(rideFixture.id), progress);
  });

  it("remembers which ride is recording across a restart", () => {
    resetDatabaseForTests();
    initDatabase();

    assert.equal(getActiveRecording(), null);

    setActiveRecording({
      rideId: rideFixture.id,
      sensorSource: "phone",
      startedAt: rideFixture.startedAt,
    });

    assert.deepEqual(getActiveRecording(), {
      rideId: rideFixture.id,
      sensorSource: "phone",
      startedAt: rideFixture.startedAt,
    });

    clearActiveRecording();
    assert.equal(getActiveRecording(), null);
  });

  it("records when a failed operation may next be sent", () => {
    resetDatabaseForTests();
    initDatabase();
    createRide(rideFixture);

    const [operation] = getQueuedChanges();

    assert.ok(operation);

    const now = 1760000000000;

    markPendingChangesFailed([operation.operationId], "Network request failed", () => now + 5_000);

    assert.equal(getQueuedChanges()[0]?.nextAttemptAt, now + 5_000);

    const summary = getPendingChangeSummary(now);

    assert.equal(summary.pending, 1);
    assert.equal(summary.due, 0);
    assert.equal(summary.failing, 1);
    assert.equal(summary.nextAttemptAt, now + 5_000);
    assert.equal(summary.lastError, "Network request failed");
  });

  it("counts attempts so the wait can grow", () => {
    resetDatabaseForTests();
    initDatabase();
    createRide(rideFixture);

    const [operation] = getQueuedChanges();

    assert.ok(operation);

    const attemptsSeen: number[] = [];
    const retryAt = (attempts: number) => {
      attemptsSeen.push(attempts);
      return 0;
    };

    markPendingChangesFailed([operation.operationId], "first", retryAt);
    markPendingChangesFailed([operation.operationId], "second", retryAt);
    markPendingChangesFailed([operation.operationId], "third", retryAt);

    assert.deepEqual(attemptsSeen, [1, 2, 3]);
    assert.equal(getQueuedChanges()[0]?.attempts, 3);
  });

  it("stops retrying an operation once it is accepted", () => {
    resetDatabaseForTests();
    initDatabase();
    createRide(rideFixture);

    const [operation] = getQueuedChanges();

    assert.ok(operation);

    markPendingChangesSynced([{ operationId: operation.operationId, status: "applied" }]);

    assert.equal(getPendingChangeCount(), 0);
    assert.equal(getPendingChangeSummary().pending, 0);
  });

  it("round-trips research collection metadata without expanding the raw recording", () => {
    resetDatabaseForTests();
    initDatabase();

    const collection: ResearchCollection = {
      id: "field-collection-1",
      captureId: 42,
      createdAt: 1760001000000,
      category: "airborne-contact",
      label: "curb hops",
      note: "three repeated hops",
      durationSeconds: 30,
      rateHz: 1666,
      sampleCount: 49980,
      recordingUri: "file:///research/field-collection-1.skateresearch",
      photoUri: "file:///research/surface.jpg",
      startLocation: {
        latitude: 52.3676,
        longitude: 4.9041,
        accuracy: 8,
        altitude: 2,
        speed: 0,
        timestamp: 1760000999000,
      },
      endLocation: null,
      transferMs: 120000,
      report: { complete: true, rateWithinTolerance: true },
    };

    saveResearchCollection(collection);
    assert.deepEqual(
      getResearchCollections().find((item) => item.id === collection.id),
      collection
    );
  });
});
