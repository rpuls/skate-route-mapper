import { Prisma } from "../../../generated/prisma/index.js";
import type {
  MeasurementSample,
  RideStartPayload,
} from "@skate-route-mapper/shared/mobileContracts";
import { prisma } from "../../db/prisma.js";

type RideOwnership = {
  userId?: string | null;
  deviceId?: string | null;
};

type RideWriteAccess = {
  userId?: string | null;
};

function assertRideWriteAccess(
  ride: { userId: string | null },
  access: RideWriteAccess
) {
  if (access.userId && ride.userId && ride.userId !== access.userId) {
    throw new Error("Ride access denied");
  }
}

export async function createRide(payload: RideStartPayload, ownership: RideOwnership = {}) {
  await prisma.ride.upsert({
    where: { id: payload.rideId },
    update: {},
    create: {
      id: payload.rideId,
      userId: ownership.userId ?? null,
      deviceId: ownership.deviceId ?? null,
      startedAt: new Date(payload.startedAt),
      vehicleType: payload.vehicleType,
      sensorSource: payload.sensorSource,
      clientId: payload.clientId ?? null,
      appVersion: payload.appVersion ?? null,
      deviceModel: payload.deviceModel ?? null,
    },
  });
}

export async function appendSamples(
  rideId: string,
  samples: MeasurementSample[],
  access: RideWriteAccess = {}
) {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const ride = await tx.ride.findUnique({
      where: { id: rideId },
      select: {
        id: true,
        userId: true,
        endedAt: true,
        sampleCount: true,
        gpsPointCount: true,
        avgVibration: true,
        maxVibration: true,
      },
    });

    if (!ride) {
      throw new Error("Ride not found");
    }

    assertRideWriteAccess(ride, access);

    if (ride.endedAt) {
      throw new Error("Ride already finished");
    }

    await tx.sample.createMany({
      data: samples.map((sample) => ({
        rideId,
        recordedAt: new Date(sample.timestamp),
        ax: sample.ax,
        ay: sample.ay,
        az: sample.az,
        gx: sample.gx,
        gy: sample.gy,
        gz: sample.gz,
        vibrationMagnitude: sample.vibrationMagnitude,
        latitude: sample.latitude,
        longitude: sample.longitude,
        speed: sample.speed,
        locationTimestamp:
          sample.locationTimestamp === null || sample.locationTimestamp === undefined
            ? null
            : new Date(sample.locationTimestamp),
        locationAccuracy: sample.locationAccuracy ?? null,
        locationAgeMs: sample.locationAgeMs ?? null,
      })),
    });

    const sampleCount = samples.length;
    const gpsPointCount = samples.filter(
      (sample) => sample.latitude !== null && sample.longitude !== null
    ).length;
    const batchMax = Math.max(...samples.map((sample) => sample.vibrationMagnitude));
    const batchSum = samples.reduce((sum, sample) => sum + sample.vibrationMagnitude, 0);
    const nextSampleCount = ride.sampleCount + sampleCount;
    const nextAverage =
      nextSampleCount === 0
        ? null
        : ((ride.avgVibration ?? 0) * ride.sampleCount + batchSum) / nextSampleCount;

    await tx.ride.update({
      where: { id: rideId },
      data: {
        sampleCount: {
          increment: sampleCount,
        },
        gpsPointCount: {
          increment: gpsPointCount,
        },
        avgVibration: nextAverage,
        maxVibration:
          ride.maxVibration === null
            ? batchMax
            : Math.max(ride.maxVibration, batchMax),
      },
    });
  });
}

export async function finishRide(
  rideId: string,
  endedAt: number,
  access: RideWriteAccess = {}
) {
  const ride = await prisma.ride.findUnique({
    where: {
      id: rideId,
    },
    select: {
      userId: true,
    },
  });

  if (!ride) {
    throw new Error("Ride not found");
  }

  assertRideWriteAccess(ride, access);

  await prisma.ride.update({
    where: {
      id: rideId,
    },
    data: {
      endedAt: new Date(endedAt),
    },
  });
}

export async function listRides(limit: number) {
  return prisma.ride.findMany({
    take: limit,
    orderBy: {
      startedAt: "desc",
    },
  });
}

export async function getRide(rideId: string) {
  const ride = await prisma.ride.findUnique({
    where: {
      id: rideId,
    },
  });

  if (!ride) {
    return null;
  }

  const samples = await prisma.sample.findMany({
    where: {
      rideId,
    },
    orderBy: {
      recordedAt: "asc",
    },
    select: {
      recordedAt: true,
      ax: true,
      ay: true,
      az: true,
      gx: true,
      gy: true,
      gz: true,
      vibrationMagnitude: true,
      latitude: true,
      longitude: true,
      speed: true,
      locationTimestamp: true,
      locationAccuracy: true,
      locationAgeMs: true,
    },
  });

  return {
    ride,
    samples: samples.map((sample) => ({
      timestamp: sample.recordedAt.getTime(),
      ax: sample.ax,
      ay: sample.ay,
      az: sample.az,
      gx: sample.gx,
      gy: sample.gy,
      gz: sample.gz,
      vibrationMagnitude: sample.vibrationMagnitude,
      latitude: sample.latitude,
      longitude: sample.longitude,
      speed: sample.speed,
      locationTimestamp: sample.locationTimestamp?.getTime() ?? null,
      locationAccuracy: sample.locationAccuracy,
      locationAgeMs: sample.locationAgeMs,
    })),
  };
}
