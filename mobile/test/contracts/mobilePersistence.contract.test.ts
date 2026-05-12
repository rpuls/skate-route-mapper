import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MeasurementSample } from "@skate-route-mapper/shared/mobileContracts";
import {
  createRide,
  finishRide,
  getRide,
  getRides,
  getSamplesForRide,
  initDatabase,
  insertSamples,
} from "../../src/database/db.web.js";

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
  });
});
