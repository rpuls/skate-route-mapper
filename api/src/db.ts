import { Prisma, PrismaClient } from "../generated/prisma/index.js";
import type { AdminResource } from "@skate-route-mapper/shared/adminResources";
import type {
  AdminUserCreatePayload,
  AdminUserUpdatePayload,
  MeasurementSample,
  RideStartPayload,
} from "@skate-route-mapper/shared/contracts";
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
    },
    select: {
      id: true,
      email: true,
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
    },
  };
}

const adminUserSelect = {
  id: true,
  email: true,
  name: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AdminUserSelect;

function serializeAdminUser(user: Prisma.AdminUserGetPayload<{ select: typeof adminUserSelect }>) {
  return {
    ...user,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function listAdminUsers() {
  const users = await prisma.adminUser.findMany({
    orderBy: {
      createdAt: "asc",
    },
    select: adminUserSelect,
  });

  return users.map(serializeAdminUser);
}

export async function createAdminUser(payload: AdminUserCreatePayload) {
  const user = await prisma.adminUser.create({
    data: {
      email: payload.email.toLowerCase(),
      passwordHash: hashPassword(payload.password),
      name: payload.name?.trim() || null,
      active: payload.active ?? true,
    },
    select: adminUserSelect,
  });

  return serializeAdminUser(user);
}

export async function updateAdminUser(id: string, payload: AdminUserUpdatePayload) {
  const data: Prisma.AdminUserUpdateInput = {};

  if (payload.email !== undefined) {
    data.email = payload.email.toLowerCase();
  }

  if (payload.password !== undefined) {
    data.passwordHash = hashPassword(payload.password);
  }

  if (payload.name !== undefined) {
    data.name = payload.name?.trim() || null;
  }

  if (payload.active !== undefined) {
    data.active = payload.active;
  }

  const user = await prisma.adminUser.update({
    where: {
      id,
    },
    data,
    select: adminUserSelect,
  });

  return serializeAdminUser(user);
}

function serializeEntityValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeEntityValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, serializeEntityValue(entryValue)])
    );
  }

  return value;
}

function getDelegate(delegate: string) {
  const prismaRecord = prisma as unknown as Record<string, unknown>;
  const modelDelegate = prismaRecord[delegate];

  if (!modelDelegate || typeof modelDelegate !== "object") {
    throw new Error("Admin resource not found");
  }

  return modelDelegate as {
    create: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown[]>;
    update: (args: unknown) => Promise<unknown>;
  };
}

function selectVisibleFields(resource: AdminResource) {
  return Object.fromEntries(
    resource.fields
      .filter((field) => field.list && field.name !== "password")
      .map((field) => [field.name, true])
  );
}

function coerceEntityValue(value: unknown, field: AdminResource["fields"][number]) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (field.type === "boolean") {
    return Boolean(value);
  }

  if (field.type === "number") {
    return Number(value);
  }

  if (field.type === "bigint") {
    return BigInt(String(value));
  }

  if (field.type === "datetime") {
    return new Date(String(value));
  }

  return String(value);
}

function buildEntityData(resource: AdminResource, payload: Record<string, unknown>, mode: "create" | "edit") {
  const data = resource.fields.reduce<Record<string, unknown>>((nextData, field) => {
    const canWrite = mode === "create" ? field.create : field.edit;

    if (!canWrite || field.name === "password" || !(field.name in payload)) {
      return nextData;
    }

    nextData[field.name] = coerceEntityValue(payload[field.name], field);
    return nextData;
  }, {});

  if (resource.name === "adminUsers" && typeof payload.password === "string" && payload.password.length > 0) {
    if (payload.password.length < 12) {
      throw new Error("Admin password must be at least 12 characters");
    }

    data.passwordHash = hashPassword(payload.password);
  }

  if (resource.name === "adminUsers" && mode === "create" && typeof data.passwordHash !== "string") {
    throw new Error("Admin password must be at least 12 characters");
  }

  return data;
}

function coerceEntityId(resource: AdminResource, rawId: string) {
  const idField = resource.fields.find((field) => field.name === resource.idField);

  if (idField?.type === "bigint") {
    return BigInt(rawId);
  }

  if (idField?.type === "number") {
    return Number(rawId);
  }

  return rawId;
}

export async function listAdminEntity(resource: AdminResource, delegate: string) {
  const items = await getDelegate(delegate).findMany({
    orderBy: {
      [resource.idField]: "desc",
    },
    select: selectVisibleFields(resource),
    take: 100,
  });

  return items.map((item) => serializeEntityValue(item));
}

export async function createAdminEntity(
  resource: AdminResource,
  delegate: string,
  payload: Record<string, unknown>
) {
  const item = await getDelegate(delegate).create({
    data: buildEntityData(resource, payload, "create"),
    select: selectVisibleFields(resource),
  });

  return serializeEntityValue(item);
}

export async function updateAdminEntity(
  resource: AdminResource,
  delegate: string,
  rawId: string,
  payload: Record<string, unknown>
) {
  const item = await getDelegate(delegate).update({
    where: {
      [resource.idField]: coerceEntityId(resource, rawId),
    },
    data: buildEntityData(resource, payload, "edit"),
    select: selectVisibleFields(resource),
  });

  return serializeEntityValue(item);
}

export async function deleteAdminEntity(
  resource: AdminResource,
  delegate: string,
  rawId: string
) {
  await getDelegate(delegate).delete({
    where: {
      [resource.idField]: coerceEntityId(resource, rawId),
    },
  });
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
