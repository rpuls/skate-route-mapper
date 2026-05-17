import type { FastifyInstance } from "fastify";
import {
  readBearerToken,
  requireMobileUserAuth,
  requireMobileUserOrIngestionOrAdminAuth,
  type MobileAuthContext,
} from "../auth/index.js";
import { env } from "../config/env.js";
import * as ExperimentalCaptures from "../features/experimentalCaptures/index.js";
import * as MobileUsers from "../features/mobileUsers/index.js";
import * as Rides from "../features/rides/index.js";
import * as Sync from "../features/sync/index.js";

type MobileAuthenticatedRequest = {
  mobileAuth?: MobileAuthContext;
};

function getMobileUserId(request: unknown) {
  const auth = (request as MobileAuthenticatedRequest).mobileAuth;

  return auth?.kind === "user" ? auth.user.id : null;
}

const requireMobileUserOrIngestionOrAdmin = async (
  request: Parameters<typeof requireMobileUserOrIngestionOrAdminAuth>[0],
  reply: Parameters<typeof requireMobileUserOrIngestionOrAdminAuth>[1]
) => {
  const auth = await requireMobileUserOrIngestionOrAdminAuth(
    request,
    reply,
    env.MOBILE_INGESTION_API_KEY,
    env.ADMIN_API_KEY
  );

  if (auth) {
    (request as MobileAuthenticatedRequest).mobileAuth = auth;
  }
};

const requireMobileUser = async (
  request: Parameters<typeof requireMobileUserAuth>[0],
  reply: Parameters<typeof requireMobileUserAuth>[1]
) => {
  const auth = await requireMobileUserAuth(request, reply);

  if (auth) {
    (request as MobileAuthenticatedRequest).mobileAuth = auth;
  }
};

export async function registerMobileRoutes(app: FastifyInstance) {
  app.post("/v1/mobile/auth/signup", async (request, reply) => {
    const payload = MobileUsers.mobileSignupSchema.parse(request.body);
    const session = await MobileUsers.signupMobileUser(payload);

    return reply.code(201).send(session);
  });

  app.post("/v1/mobile/auth/login", async (request, reply) => {
    const payload = MobileUsers.mobileLoginSchema.parse(request.body);
    const session = await MobileUsers.loginMobileUser(payload);

    return reply.code(200).send(session);
  });

  app.post("/v1/mobile/auth/logout", {
    preHandler: requireMobileUser,
  }, async (request, reply) => {
    const token = readBearerToken(request);

    if (token) {
      await MobileUsers.revokeMobileUserSession(token);
    }

    return reply.code(200).send({
      ok: true,
    });
  });

  app.get("/v1/mobile/me", {
    preHandler: requireMobileUser,
  }, async (request, reply) => {
    const auth = (request as MobileAuthenticatedRequest).mobileAuth;

    if (!auth || auth.kind !== "user") {
      return reply.code(401).send({
        ok: false,
        message: "Unauthorized",
      });
    }

    const user = await MobileUsers.getCurrentMobileUser(auth.user.id);

    if (!user) {
      return reply.code(404).send({
        ok: false,
        message: "User not found",
      });
    }

    return {
      user,
    };
  });

  app.post("/v1/mobile/rides/start", {
    preHandler: requireMobileUserOrIngestionOrAdmin,
  }, async (request, reply) => {
    const payload = Rides.rideStartSchema.parse(request.body);
    const userId = getMobileUserId(request);
    const device = await MobileUsers.upsertMobileDevice(payload, userId);

    await Rides.createRide(payload, {
      userId,
      deviceId: device?.id ?? null,
    });

    return reply.code(201).send({
      ok: true,
      rideId: payload.rideId,
    });
  });

  app.post("/v1/mobile/rides/:rideId/samples", {
    preHandler: requireMobileUserOrIngestionOrAdmin,
  }, async (request, reply) => {
    const { rideId } = Rides.rideParamsSchema.parse(request.params);
    const payload = Rides.rideSamplesSchema.parse(request.body);
    await Rides.appendSamples(rideId, payload.samples, {
      userId: getMobileUserId(request),
    });

    return reply.code(202).send({
      ok: true,
      rideId,
      accepted: payload.samples.length,
    });
  });

  app.post("/v1/mobile/rides/:rideId/finish", {
    preHandler: requireMobileUserOrIngestionOrAdmin,
  }, async (request, reply) => {
    const { rideId } = Rides.rideParamsSchema.parse(request.params);
    const payload = Rides.rideFinishSchema.parse(request.body);
    await Rides.finishRide(rideId, payload.endedAt, {
      userId: getMobileUserId(request),
    });

    return reply.code(200).send({
      ok: true,
      rideId,
    });
  });

  app.post("/v1/mobile/sync", {
    preHandler: requireMobileUserOrIngestionOrAdmin,
  }, async (request, reply) => {
    const payload = Sync.syncRequestSchema.parse(request.body);
    const syncResult = await Sync.processSyncOperations(payload.operations, {
      userId: getMobileUserId(request),
    });

    return reply.code(200).send(syncResult);
  });

  app.post("/v1/mobile/experimental-captures", {
    preHandler: requireMobileUser,
  }, async (request, reply) => {
    const payload = ExperimentalCaptures.experimentalCaptureSchema.parse(request.body);
    const capture = await ExperimentalCaptures.createExperimentalCapture(payload, {
      userId: getMobileUserId(request),
    });

    return reply.code(201).send({
      ok: true,
      captureId: capture.id,
    });
  });
}
