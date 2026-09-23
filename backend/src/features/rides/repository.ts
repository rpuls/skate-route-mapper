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
    const vibration = nextVibrationAggregate(ride, samples);

    await tx.ride.update({
      where: { id: rideId },
      data: {
        sampleCount: {
          increment: sampleCount,
        },
        gpsPointCount: {
          increment: gpsPointCount,
        },
        avgVibration: vibration.avgVibration,
        maxVibration: vibration.maxVibration,
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

export async function getRide(
  rideId: string,
  options: {
    sampleLimit: number;
    sampleOffset: number;
  } = {
    sampleLimit: 5000,
    sampleOffset: 0,
  }
) {
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
    skip: options.sampleOffset,
    take: options.sampleLimit,
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
    sampleLimit: options.sampleLimit,
    sampleOffset: options.sampleOffset,
    samplesReturned: samples.length,
    samplesTruncated: options.sampleOffset + samples.length < ride.sampleCount,
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

// A sample may carry only a GPS fix: phone-tracked rides have no IMU data, and
// vibration arrives from the external XIAO board. Aggregate over the readings
// that exist so a GPS-only batch leaves the ride's vibration figures untouched
// instead of dragging the average toward zero.
export function nextVibrationAggregate(
  ride: { sampleCount: number; avgVibration: number | null; maxVibration: number | null },
  samples: { vibrationMagnitude: number | null }[]
) {
  const readings = samples
    .map((sample) => sample.vibrationMagnitude)
    .filter((value): value is number => value !== null);

  if (readings.length === 0) {
    return {
      avgVibration: ride.avgVibration,
      maxVibration: ride.maxVibration,
    };
  }

  const batchSum = readings.reduce((sum, value) => sum + value, 0);
  const batchMax = Math.max(...readings);
  const nextCount = ride.sampleCount + readings.length;

  return {
    avgVibration: ((ride.avgVibration ?? 0) * ride.sampleCount + batchSum) / nextCount,
    maxVibration:
      ride.maxVibration === null ? batchMax : Math.max(ride.maxVibration, batchMax),
  };
}
