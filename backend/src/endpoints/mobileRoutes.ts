import type { FastifyInstance } from "fastify";
import { requireMobileOrAdminAuth } from "../auth/index.js";
import { env } from "../config/env.js";
import * as Rides from "../features/rides/index.js";

const requireMobileOrAdmin = async (
  request: Parameters<typeof requireMobileOrAdminAuth>[0],
  reply: Parameters<typeof requireMobileOrAdminAuth>[1]
) => {
  await requireMobileOrAdminAuth(request, reply, env.MOBILE_INGESTION_API_KEY, env.ADMIN_API_KEY);
};

export async function registerMobileRoutes(app: FastifyInstance) {
  app.post("/v1/mobile/rides/start", {
    preHandler: requireMobileOrAdmin,
  }, async (request, reply) => {
    const payload = Rides.rideStartSchema.parse(request.body);
    await Rides.createRide(payload);

    return reply.code(201).send({
      ok: true,
      rideId: payload.rideId,
    });
  });

  app.post("/v1/mobile/rides/:rideId/samples", {
    preHandler: requireMobileOrAdmin,
  }, async (request, reply) => {
    const { rideId } = Rides.rideParamsSchema.parse(request.params);
    const payload = Rides.rideSamplesSchema.parse(request.body);
    await Rides.appendSamples(rideId, payload.samples);

    return reply.code(202).send({
      ok: true,
      rideId,
      accepted: payload.samples.length,
    });
  });

  app.post("/v1/mobile/rides/:rideId/finish", {
    preHandler: requireMobileOrAdmin,
  }, async (request, reply) => {
    const { rideId } = Rides.rideParamsSchema.parse(request.params);
    const payload = Rides.rideFinishSchema.parse(request.body);
    await Rides.finishRide(rideId, payload.endedAt);

    return reply.code(200).send({
      ok: true,
      rideId,
    });
  });
}
