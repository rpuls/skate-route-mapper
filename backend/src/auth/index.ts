import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db/prisma.js";
import { hashSessionToken } from "./tokens.js";

export type AdminAuthContext =
  | {
      kind: "apiKey";
    }
  | {
      kind: "session";
      adminUser: {
        id: string;
        email: string;
      };
    };

export type MobileAuthContext =
  | {
      kind: "ingestionApiKey";
    }
  | {
      kind: "admin";
      admin: AdminAuthContext;
    }
  | {
      kind: "user";
      user: {
        id: string;
        email: string;
      };
    };

export function readBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

export function readApiKey(request: FastifyRequest) {
  const bearerToken = readBearerToken(request);
  const apiKey = request.headers["x-api-key"];

  if (bearerToken) {
    return bearerToken;
  }

  if (typeof apiKey === "string") {
    return apiKey.trim();
  }

  return null;
}

async function authenticateAdmin(request: FastifyRequest, adminApiKey: string) {
  const providedKey = readApiKey(request);

  if (providedKey && keysMatch(providedKey, adminApiKey)) {
    return {
      kind: "apiKey",
    } satisfies AdminAuthContext;
  }

  const bearerToken = readBearerToken(request);

  if (!bearerToken) {
    return null;
  }

  const session = await prisma.adminSession.findUnique({
    where: {
      tokenHash: hashSessionToken(bearerToken),
    },
    select: {
      expiresAt: true,
      revokedAt: true,
      adminUser: {
        select: {
          id: true,
          email: true,
          active: true,
        },
      },
    },
  });

  if (
    !session ||
    !session.adminUser.active ||
    session.revokedAt ||
    session.expiresAt <= new Date()
  ) {
    return null;
  }

  return {
    kind: "session",
    adminUser: {
      id: session.adminUser.id,
      email: session.adminUser.email,
    },
  } satisfies AdminAuthContext;
}

export async function authenticateMobileUser(request: FastifyRequest) {
  const bearerToken = readBearerToken(request);

  if (!bearerToken) {
    return null;
  }

  const session = await prisma.userSession.findUnique({
    where: {
      tokenHash: hashSessionToken(bearerToken),
    },
    select: {
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
  };
}

export function keysMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export async function requireAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  adminApiKey: string
) {
  const adminAuth = await authenticateAdmin(request, adminApiKey);

  if (adminAuth) {
    return adminAuth;
  }

  reply.header("WWW-Authenticate", 'Bearer realm="admin"');
  reply.code(401).send({
    ok: false,
    message: "Unauthorized",
  });
  return false;
}

export async function requireMobileOrAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  mobileIngestionApiKey: string,
  adminApiKey: string
) {
  const providedKey = readApiKey(request);

  if (providedKey && keysMatch(providedKey, mobileIngestionApiKey)) {
    return {
      kind: "ingestionApiKey",
    } satisfies MobileAuthContext;
  }

  const adminAuth = await authenticateAdmin(request, adminApiKey);

  if (adminAuth) {
    return {
      kind: "admin",
      admin: adminAuth,
    } satisfies MobileAuthContext;
  }

  reply.header("WWW-Authenticate", 'Bearer realm="mobile"');
  reply.code(401).send({
    ok: false,
    message: "Unauthorized",
  });
  return false;
}

export async function requireMobileUserAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const user = await authenticateMobileUser(request);

  if (user) {
    return {
      kind: "user",
      user,
    } satisfies MobileAuthContext;
  }

  reply.header("WWW-Authenticate", 'Bearer realm="mobile-user"');
  reply.code(401).send({
    ok: false,
    message: "Unauthorized",
  });
  return false;
}

export async function requireMobileUserOrIngestionOrAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  mobileIngestionApiKey: string,
  adminApiKey: string
) {
  const user = await authenticateMobileUser(request);

  if (user) {
    return {
      kind: "user",
      user,
    } satisfies MobileAuthContext;
  }

  return requireMobileOrAdminAuth(request, reply, mobileIngestionApiKey, adminApiKey);
}
