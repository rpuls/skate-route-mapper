import type {
  MobileAuthResponse,
  MobileDeviceIdentity,
  MobileLoginPayload,
  MobileSignupPayload,
} from "@skate-route-mapper/shared/mobileContracts";
import { hashPassword, verifyPassword } from "../../auth/passwords.js";
import { createSessionToken, hashSessionToken } from "../../auth/tokens.js";
import { prisma } from "../../db/prisma.js";

const userSessionTtlDays = 30;

const userSelect = {
  id: true,
  email: true,
  name: true,
} as const;

type MobileUserRecord = {
  id: string;
  email: string;
  name: string | null;
};

function serializeUser(user: MobileUserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

function getSessionExpiry() {
  return new Date(Date.now() + userSessionTtlDays * 24 * 60 * 60 * 1000);
}

async function createUserSession(userId: string) {
  const token = createSessionToken();
  const expiresAt = getSessionExpiry();

  await prisma.userSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    },
  });

  return {
    token,
    expiresAt,
  };
}

export async function upsertMobileDevice(
  identity: MobileDeviceIdentity,
  userId: string | null
) {
  if (!identity.clientId) {
    return null;
  }

  const now = new Date();

  return prisma.device.upsert({
    where: {
      clientId: identity.clientId,
    },
    update: {
      userId,
      deviceModel: identity.deviceModel ?? null,
      appVersion: identity.appVersion ?? null,
      lastSeenAt: now,
    },
    create: {
      userId,
      clientId: identity.clientId,
      deviceModel: identity.deviceModel ?? null,
      appVersion: identity.appVersion ?? null,
      lastSeenAt: now,
    },
    select: {
      id: true,
    },
  });
}

export async function signupMobileUser(
  payload: MobileSignupPayload
): Promise<MobileAuthResponse> {
  const user = await prisma.user.create({
    data: {
      email: payload.email.toLowerCase(),
      passwordHash: hashPassword(payload.password),
      name: payload.name?.trim() || null,
    },
    select: userSelect,
  });

  const [session, device] = await Promise.all([
    createUserSession(user.id),
    upsertMobileDevice(payload, user.id),
  ]);

  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: serializeUser(user),
    deviceId: device?.id ?? null,
  };
}

export async function loginMobileUser(
  payload: MobileLoginPayload
): Promise<MobileAuthResponse> {
  const user = await prisma.user.findUnique({
    where: {
      email: payload.email.toLowerCase(),
    },
    select: {
      ...userSelect,
      passwordHash: true,
    },
  });

  if (!user || !verifyPassword(payload.password, user.passwordHash)) {
    throw new Error("Invalid user credentials");
  }

  const [session, device] = await Promise.all([
    createUserSession(user.id),
    upsertMobileDevice(payload, user.id),
    prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        lastLoginAt: new Date(),
      },
    }),
  ]);

  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: serializeUser(user),
    deviceId: device?.id ?? null,
  };
}

export async function getCurrentMobileUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: userSelect,
  });

  return user ? serializeUser(user) : null;
}

export async function revokeMobileUserSession(token: string) {
  await prisma.userSession.updateMany({
    where: {
      tokenHash: hashSessionToken(token),
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}
