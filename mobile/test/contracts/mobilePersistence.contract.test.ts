import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MeasurementSample } from "@skate-route-mapper/shared/mobileContracts";
import {
  createRide,
  finishRide,
  getPendingChangeCount,
  getPendingChanges,
  getRide,
  getRides,
  getResearchCollections,
  getSamplesForRide,
  initDatabase,
  insertSamples,
  saveResearchCollection,
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
    initDatabase();

    createRide(rideFixture);
    insertSamples(rideFixture.id, [...sampleFixtures].reverse());
    finishRide(rideFixture.id, 1760000900000);

    assert.deepEqual(getRide(rideFixture.id), {
      id: rideFixture.id,
      startedAt: rideFixture.startedAt,
      endedAt: 1760000900000,
      vehicleType: rideFixture.vehicleType,
      sensorSource: rideFixture.sensorSource,
      sampleCount: sampleFixtures.length,
    });

    assert.deepEqual(getSamplesForRide(rideFixture.id), sampleFixtures);
    assert.equal(getRides().some((ride) => ride.id === rideFixture.id), true);
    assert.equal(getPendingChangeCount(), 3);
    assert.deepEqual(
      getPendingChanges().map((change) => change.type),
      ["ride.start", "ride.samples", "ride.finish"]
    );
  });

  it("round-trips research collection metadata without expanding the raw recording", () => {
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
