import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
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

export function readBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

function readApiKey(request: FastifyRequest) {
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

export function keysMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedKey: string,
  realm: "admin" | "ingestion"
) {
  const providedKey = readApiKey(request);

  if (!providedKey || !keysMatch(providedKey, expectedKey)) {
    reply.header("WWW-Authenticate", `Bearer realm="${realm}"`);
    reply.code(401).send({
      ok: false,
      message: "Unauthorized",
    });
    return false;
  }

  return true;
}

export async function requireAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  adminApiKey: string
) {
  const providedKey = readApiKey(request);

  if (providedKey && keysMatch(providedKey, adminApiKey)) {
    return {
      kind: "apiKey",
    } satisfies AdminAuthContext;
  }

  const bearerToken = readBearerToken(request);

  if (bearerToken) {
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
      session &&
      session.adminUser.active &&
      !session.revokedAt &&
      session.expiresAt > new Date()
    ) {
      return {
        kind: "session",
        adminUser: {
          id: session.adminUser.id,
          email: session.adminUser.email,
        },
      } satisfies AdminAuthContext;
    }
  }

  reply.header("WWW-Authenticate", 'Bearer realm="admin"');
  reply.code(401).send({
    ok: false,
    message: "Unauthorized",
  });
  return false;
}
