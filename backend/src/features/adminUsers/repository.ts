import { Prisma } from "../../../generated/prisma/index.js";
import type {
  AdminUserCreatePayload,
  AdminUserUpdatePayload,
} from "@skate-route-mapper/shared/contracts";
import { hashPassword, verifyPassword } from "../../auth/passwords.js";
import { createSessionToken, hashSessionToken } from "../../auth/tokens.js";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";

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
