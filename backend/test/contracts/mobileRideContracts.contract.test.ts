import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as mobileContracts from "@skate-route-mapper/shared/mobileContracts";
import {
  sensorSources,
  vehicleTypes,
  type CurrentMobileUser,
  type MobileAuthResponse,
  type MobileLoginPayload,
  type MobileSignupPayload,
  type RideFinishPayload,
  type RideSamplesPayload,
  type RideStartPayload,
  type SyncRequest,
} from "@skate-route-mapper/shared/mobileContracts";
import {
  currentMobileUserSchema,
  mobileAuthResponseSchema,
  mobileLoginSchema,
  mobileSignupSchema,
} from "../../src/features/mobileUsers/contracts.js";
import {
  acceptedSensorSources,
  acceptedVehicleTypes,
  measurementSampleSchema,
  rideFinishSchema,
  rideSamplesSchema,
  rideStartSchema,
} from "../../src/features/rides/contracts.js";
import { syncRequestSchema } from "../../src/features/sync/contracts.js";

const rideStartFixture = {
  rideId: "0d4c61cf-1d7a-4ca8-9e56-fd4185dd0df8",
  startedAt: 1760000000000,
  vehicleType: "skates",
  sensorSource: "phone",
  clientId: "device-abc-123",
  appVersion: "1.0.0",
  deviceModel: "iPhone 15",
} satisfies RideStartPayload;

const rideSamplesFixture = {
  samples: [
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
  ],
} satisfies RideSamplesPayload;

const rideFinishFixture = {
  endedAt: 1760000900000,
} satisfies RideFinishPayload;

const syncRequestFixture = {
  operations: [
    {
      operationId: "op-start",
      type: "ride.start",
      createdAt: 1760000000000,
      payload: rideStartFixture,
    },
    {
      operationId: "op-samples",
      type: "ride.samples",
      createdAt: 1760000001000,
      payload: {
        rideId: rideStartFixture.rideId,
        samples: rideSamplesFixture.samples,
      },
    },
    {
      operationId: "op-finish",
      type: "ride.finish",
      createdAt: 1760000900000,
      payload: {
        rideId: rideStartFixture.rideId,
        endedAt: rideFinishFixture.endedAt,
      },
    },
  ],
} satisfies SyncRequest;

const mobileSignupFixture = {
  email: "rider@example.com",
  password: "correct-horse-battery",
  name: "Rider One",
  clientId: "device-abc-123",
  appVersion: "1.0.0",
  deviceModel: "iPhone 15",
} satisfies MobileSignupPayload;

const mobileLoginFixture = {
  email: "rider@example.com",
  password: "correct-horse-battery",
  clientId: "device-abc-123",
  appVersion: "1.0.0",
  deviceModel: "iPhone 15",
} satisfies MobileLoginPayload;

const currentMobileUserFixture = {
  id: "cmuser123",
  email: "rider@example.com",
  name: "Rider One",
} satisfies CurrentMobileUser;

const mobileAuthResponseFixture = {
  ok: true,
  token: "session-token-returned-once",
  expiresAt: "2026-06-11T20:00:00.000Z",
  user: currentMobileUserFixture,
  deviceId: "cmdevice123",
} satisfies MobileAuthResponse;

describe("mobile ride contract", () => {
  it("keeps admin-only symbols out of the mobile contract runtime module", () => {
    const exportedNames = Object.keys(mobileContracts);

    assert.equal(exportedNames.some((name) => name.startsWith("Admin")), false);
  });

  it("keeps shared enum values accepted by backend validation", () => {
    assert.deepEqual(acceptedVehicleTypes, vehicleTypes);
    assert.deepEqual(acceptedSensorSources, sensorSources);

    for (const vehicleType of acceptedVehicleTypes) {
      assert.equal(rideStartSchema.safeParse({
        ...rideStartFixture,
        vehicleType,
      }).success, true);
    }

    for (const sensorSource of acceptedSensorSources) {
      assert.equal(rideStartSchema.safeParse({
        ...rideStartFixture,
        sensorSource,
      }).success, true);
    }
  });

  it("accepts the mobile ride start fixture", () => {
    assert.equal(rideStartSchema.safeParse(rideStartFixture).success, true);
  });

  it("accepts mobile sample batches including GPS confidence metadata", () => {
    assert.equal(rideSamplesSchema.safeParse(rideSamplesFixture).success, true);
  });

  it("accepts a single mobile sample fixture directly", () => {
    assert.equal(measurementSampleSchema.safeParse(rideSamplesFixture.samples[0]).success, true);
  });

  it("accepts the mobile ride finish fixture", () => {
    assert.equal(rideFinishSchema.safeParse(rideFinishFixture).success, true);
  });

  it("accepts mobile sync operation fixtures", () => {
    assert.equal(syncRequestSchema.safeParse(syncRequestFixture).success, true);
  });

  it("rejects invalid mobile sample coordinates", () => {
    const result = measurementSampleSchema.safeParse({
      ...rideSamplesFixture.samples[0],
      latitude: 200,
    });

    assert.equal(result.success, false);
  });
});

describe("mobile auth contract", () => {
  it("accepts the mobile signup fixture", () => {
    assert.equal(mobileSignupSchema.safeParse(mobileSignupFixture).success, true);
  });

  it("accepts the mobile login fixture", () => {
    assert.equal(mobileLoginSchema.safeParse(mobileLoginFixture).success, true);
  });

  it("keeps signup device identity optional", () => {
    assert.equal(mobileSignupSchema.safeParse({
      email: "rider@example.com",
      password: "correct-horse-battery",
    }).success, true);
  });

  it("rejects too-short mobile signup passwords", () => {
    assert.equal(mobileSignupSchema.safeParse({
      ...mobileSignupFixture,
      password: "short",
    }).success, false);
  });

  it("keeps auth response and current-user fixtures mobile-owned", () => {
    assert.equal(currentMobileUserSchema.safeParse(currentMobileUserFixture).success, true);
    assert.equal(mobileAuthResponseSchema.safeParse(mobileAuthResponseFixture).success, true);
    assert.equal(mobileAuthResponseFixture.user.email, currentMobileUserFixture.email);
    assert.equal(Object.keys(mobileAuthResponseFixture).includes("adminUser"), false);
  });
});
