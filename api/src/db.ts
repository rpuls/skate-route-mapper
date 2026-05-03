import { Prisma, PrismaClient } from "../generated/prisma/index.js";
import type { MeasurementSample, RideStartPayload } from "@skate-route-mapper/shared/contracts";
import { env } from "./config.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { createSessionToken, hashSessionToken } from "./tokens.js";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function connectDatabase() {
  await prisma.$connect();
}

export async function seedInitialAdminUser() {
  if (!env.INIT_ADMIN_EMAIL || !env.INIT_ADMIN_PASSWORD) {
    return null;
  }

  const adminCount = await prisma.adminUser.count();

  if (adminCount > 0) {
    return null;
  }

  return prisma.adminUser.create({
    data: {
      email: env.INIT_ADMIN_EMAIL.toLowerCase(),
      passwordHash: hashPassword(env.INIT_ADMIN_PASSWORD),
      role: "owner",
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
  });
}

export async function loginAdminUser(email: string, password: string) {
  const adminUser = await prisma.adminUser.findUnique({
    where: {
      email: email.toLowerCase(),
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      role: true,
      active: true,
    },
  });

  if (!adminUser || !adminUser.active || !verifyPassword(password, adminUser.passwordHash)) {
    throw new Error("Invalid admin credentials");
  }

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.adminSession.create({
      data: {
        adminUserId: adminUser.id,
        tokenHash: hashSessionToken(token),
        expiresAt,
      },
    }),
    prisma.adminUser.update({
      where: {
        id: adminUser.id,
      },
      data: {
        lastLoginAt: new Date(),
      },
    }),
  ]);

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    adminUser: {
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    },
  };
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}

export async function createRide(payload: RideStartPayload) {
  await prisma.ride.upsert({
    where: { id: payload.rideId },
    update: {},
    create: {
      id: payload.rideId,
      startedAt: new Date(payload.startedAt),
      vehicleType: payload.vehicleType,
      sensorSource: payload.sensorSource,
      clientId: payload.clientId ?? null,
      appVersion: payload.appVersion ?? null,
      deviceModel: payload.deviceModel ?? null,
    },
  });
}

export async function appendSamples(rideId: string, samples: MeasurementSample[]) {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const ride = await tx.ride.findUnique({
      where: { id: rideId },
      select: {
        id: true,
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

export async function finishRide(rideId: string, endedAt: number) {
  const result = await prisma.ride.updateMany({
    where: { id: rideId },
    data: {
      endedAt: new Date(endedAt),
    },
  });

  if (result.count === 0) {
    throw new Error("Ride not found");
  }
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
    })),
  };
}
