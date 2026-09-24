import { Prisma } from "../../../generated/prisma/index.js";
import type {
  MeasurementSample,
  RideMetricsPayload,
  RideStartPayload,
} from "@skate-route-mapper/shared/mobileContracts";
import { prisma } from "../../db/prisma.js";
import { rideMetricColumns, type RideMetricColumns } from "./metrics.js";

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
      select: rideAggregateSelection,
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

    await tx.ride.update({
      where: { id: rideId },
      data: rideSampleStatsUpdate(ride, samples),
    });
  });
}

export async function finishRide(
  rideId: string,
  endedAt: number,
  access: RideWriteAccess = {},
  reportedMetrics?: RideMetricsPayload | undefined
) {
  const ride = await prisma.ride.findUnique({
    where: {
      id: rideId,
    },
    select: {
      userId: true,
      startedAt: true,
    },
  });

  if (!ride) {
    throw new Error("Ride not found");
  }

  assertRideWriteAccess(ride, access);

  const metrics = await computeRideMetrics(prisma, {
    rideId,
    startedAt: ride.startedAt,
    endedAt,
    reportedMetrics,
  });

  await prisma.ride.update({
    where: {
      id: rideId,
    },
    data: {
      endedAt: new Date(endedAt),
      ...metrics,
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

/** The columns the ride aggregates are derived from. */
export const rideAggregateSelection = {
  id: true,
  userId: true,
  endedAt: true,
  sampleCount: true,
  gpsPointCount: true,
  vibrationSampleCount: true,
  avgVibration: true,
  maxVibration: true,
} as const;

export type RideAggregateState = {
  sampleCount: number;
  vibrationSampleCount: number;
  avgVibration: number | null;
  maxVibration: number | null;
};

// A sample may carry only a GPS fix: phone-tracked rides have no IMU data, and
// vibration arrives from the external XIAO board. Aggregate over the readings
// that exist so a GPS-only batch leaves the ride's vibration figures untouched
// instead of dragging the average toward zero.
//
// The running average is weighted by `vibrationSampleCount`, not the ride's
// total sample count: weighting by every sample would let hundreds of GPS-only
// rows dilute a handful of genuine board readings.
export function nextVibrationAggregate(
  ride: RideAggregateState,
  samples: { vibrationMagnitude: number | null }[]
) {
  const readings = samples
    .map((sample) => sample.vibrationMagnitude)
    .filter((value): value is number => value !== null);

  if (readings.length === 0) {
    return {
      avgVibration: ride.avgVibration,
      maxVibration: ride.maxVibration,
      vibrationSampleCount: ride.vibrationSampleCount,
    };
  }

  const batchSum = readings.reduce((sum, value) => sum + value, 0);
  const batchMax = Math.max(...readings);
  const nextCount = ride.vibrationSampleCount + readings.length;

  return {
    avgVibration:
      ((ride.avgVibration ?? 0) * ride.vibrationSampleCount + batchSum) / nextCount,
    maxVibration:
      ride.maxVibration === null ? batchMax : Math.max(ride.maxVibration, batchMax),
    vibrationSampleCount: nextCount,
  };
}

/**
 * The ride columns a batch of samples moves.
 *
 * Shared with the sync path so a batch that arrives through `POST /sync` and
 * one that arrives through `POST /rides/:id/samples` cannot drift apart.
 */
export function rideSampleStatsUpdate(
  ride: RideAggregateState,
  samples: MeasurementSample[]
) {
  const gpsPointCount = samples.filter(
    (sample) => sample.latitude !== null && sample.longitude !== null
  ).length;
  const vibration = nextVibrationAggregate(ride, samples);

  return {
    sampleCount: {
      increment: samples.length,
    },
    gpsPointCount: {
      increment: gpsPointCount,
    },
    vibrationSampleCount: vibration.vibrationSampleCount,
    avgVibration: vibration.avgVibration,
    maxVibration: vibration.maxVibration,
  };
}

/**
 * Load a ride's position samples and work out what it covered.
 *
 * Only samples that carry a position are read: a XIAO ride interleaves tens of
 * thousands of vibration rows that would be skipped anyway.
 *
 * The decision itself lives in `metrics.ts`, which is pure and tested.
 */
export async function computeRideMetrics(
  client: Prisma.TransactionClient,
  params: {
    rideId: string;
    startedAt: Date;
    endedAt: number;
    reportedMetrics?: RideMetricsPayload | undefined;
  }
): Promise<RideMetricColumns> {
  const samples = await client.sample.findMany({
    where: {
      rideId: params.rideId,
      latitude: { not: null },
      longitude: { not: null },
    },
    orderBy: {
      recordedAt: "asc",
    },
    select: {
      recordedAt: true,
      latitude: true,
      longitude: true,
      speed: true,
      locationTimestamp: true,
      locationAccuracy: true,
    },
  });

  return rideMetricColumns({
    samples: samples.map((sample) => ({
      timestamp: sample.recordedAt.getTime(),
      latitude: sample.latitude,
      longitude: sample.longitude,
      speed: sample.speed,
      locationTimestamp: sample.locationTimestamp?.getTime() ?? null,
      locationAccuracy: sample.locationAccuracy,
    })),
    startedAt: params.startedAt.getTime(),
    endedAt: params.endedAt,
    ...(params.reportedMetrics ? { reportedMetrics: params.reportedMetrics } : {}),
  });
}

/**
 * Recompute a ride's route figures from the samples it already has.
 *
 * Rides recorded before ride tracking existed have none, and the thresholds in
 * `rideTrackingDefaults` are reasoned rather than measured, so they will be
 * tuned once there is real outdoor data. Both cases need a way to re-run the
 * algorithm over stored rides rather than only over new ones.
 */
export async function recomputeRideMetrics(rideId: string) {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: { id: true, startedAt: true, endedAt: true },
  });

  if (!ride) {
    throw new Error("Ride not found");
  }

  const metrics = await computeRideMetrics(prisma, {
    rideId,
    startedAt: ride.startedAt,
    // An unfinished ride is measured up to its last sample, which
    // `summarizeRideProgress` falls back to when the end is unknown.
    endedAt: ride.endedAt?.getTime() ?? ride.startedAt.getTime(),
  });

  await prisma.ride.update({
    where: { id: rideId },
    data: metrics,
  });

  return metrics;
}
