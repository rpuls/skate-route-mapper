import { Prisma } from "../../../generated/prisma/index.js";
import type {
  MeasurementSample,
  SyncOperation,
  SyncOperationResult,
} from "@skate-route-mapper/shared/mobileContracts";
import { prisma } from "../../db/prisma.js";

type SyncAccess = {
  userId?: string | null;
};

function assertRideWriteAccess(
  ride: { userId: string | null },
  access: SyncAccess
) {
  if (access.userId && ride.userId && ride.userId !== access.userId) {
    throw new Error("Ride access denied");
  }
}

async function applyRideStart(
  tx: Prisma.TransactionClient,
  operation: Extract<SyncOperation, { type: "ride.start" }>,
  access: SyncAccess
) {
  await tx.ride.upsert({
    where: {
      id: operation.payload.rideId,
    },
    update: {},
    create: {
      id: operation.payload.rideId,
      userId: access.userId ?? null,
      deviceId: null,
      startedAt: new Date(operation.payload.startedAt),
      vehicleType: operation.payload.vehicleType,
      sensorSource: operation.payload.sensorSource,
      clientId: operation.payload.clientId ?? null,
      appVersion: operation.payload.appVersion ?? null,
      deviceModel: operation.payload.deviceModel ?? null,
    },
  });
}

async function applyRideSamples(
  tx: Prisma.TransactionClient,
  operation: Extract<SyncOperation, { type: "ride.samples" }>,
  access: SyncAccess
) {
  const ride = await tx.ride.findUnique({
    where: {
      id: operation.payload.rideId,
    },
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
    data: operation.payload.samples.map((sample) => ({
      rideId: operation.payload.rideId,
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

  await updateRideSampleStats(tx, ride, operation.payload.samples);
}

async function updateRideSampleStats(
  tx: Prisma.TransactionClient,
  ride: {
    id: string;
    sampleCount: number;
    gpsPointCount: number;
    avgVibration: number | null;
    maxVibration: number | null;
  },
  samples: MeasurementSample[]
) {
  const sampleCount = samples.length;
  const gpsPointCount = samples.filter(
    (sample) => sample.latitude !== null && sample.longitude !== null
  ).length;
  const batchMax = Math.max(...samples.map((sample) => sample.vibrationMagnitude));
  const batchSum = samples.reduce(
    (sum, sample) => sum + sample.vibrationMagnitude,
    0
  );
  const nextSampleCount = ride.sampleCount + sampleCount;
  const nextAverage =
    nextSampleCount === 0
      ? null
      : ((ride.avgVibration ?? 0) * ride.sampleCount + batchSum) /
        nextSampleCount;

  await tx.ride.update({
    where: {
      id: ride.id,
    },
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
}

async function applyRideFinish(
  tx: Prisma.TransactionClient,
  operation: Extract<SyncOperation, { type: "ride.finish" }>,
  access: SyncAccess
) {
  const ride = await tx.ride.findUnique({
    where: {
      id: operation.payload.rideId,
    },
    select: {
      userId: true,
    },
  });

  if (!ride) {
    throw new Error("Ride not found");
  }

  assertRideWriteAccess(ride, access);

  await tx.ride.update({
    where: {
      id: operation.payload.rideId,
    },
    data: {
      endedAt: new Date(operation.payload.endedAt),
    },
  });
}

async function applyOperation(
  tx: Prisma.TransactionClient,
  operation: SyncOperation,
  access: SyncAccess
) {
  switch (operation.type) {
    case "ride.start":
      await applyRideStart(tx, operation, access);
      break;
    case "ride.samples":
      await applyRideSamples(tx, operation, access);
      break;
    case "ride.finish":
      await applyRideFinish(tx, operation, access);
      break;
  }
}

export async function processSyncOperations(
  operations: SyncOperation[],
  access: SyncAccess = {}
) {
  const results = await prisma.$transaction(async (tx) => {
    const nextResults: SyncOperationResult[] = [];

    for (const operation of operations) {
      const existingOperation = await tx.syncOperation.findUnique({
        where: {
          id: operation.operationId,
        },
        select: {
          id: true,
        },
      });

      if (existingOperation) {
        nextResults.push({
          operationId: operation.operationId,
          status: "duplicate",
        });
        continue;
      }

      await applyOperation(tx, operation, access);

      await tx.syncOperation.create({
        data: {
          id: operation.operationId,
          userId: access.userId ?? null,
          operationType: operation.type,
          createdAtMs: BigInt(operation.createdAt),
          payload: operation as Prisma.InputJsonValue,
        },
      });

      nextResults.push({
        operationId: operation.operationId,
        status: "applied",
      });
    }

    return nextResults;
  });

  return {
    ok: true,
    results,
    serverTime: Date.now(),
    serverChanges: [],
  } as const;
}
