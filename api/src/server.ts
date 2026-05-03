import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { env } from "./config.js";
import { appendSamples, connectDatabase, createRide, disconnectDatabase, finishRide, getRide, listRides } from "./db.js";
import { rideFinishSchema, rideSamplesSchema, rideStartSchema } from "./contracts.js";

const rideParamsSchema = z.object({
  rideId: z.string().min(1),
});

const ridesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
});

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
});

app.get("/health", async () => ({
  ok: true,
  service: "skate-route-mapper-api",
}));

app.post("/v1/rides/start", async (request, reply) => {
  const payload = rideStartSchema.parse(request.body);
  await createRide(payload);
  return reply.code(201).send({
    ok: true,
    rideId: payload.rideId,
  });
});

app.post("/v1/rides/:rideId/samples", async (request, reply) => {
  const { rideId } = rideParamsSchema.parse(request.params);
  const payload = rideSamplesSchema.parse(request.body);
  await appendSamples(rideId, payload.samples);
  return reply.code(202).send({
    ok: true,
    rideId,
    accepted: payload.samples.length,
  });
});

app.post("/v1/rides/:rideId/finish", async (request, reply) => {
  const { rideId } = rideParamsSchema.parse(request.params);
  const payload = rideFinishSchema.parse(request.body);
  await finishRide(rideId, payload.endedAt);
  return reply.code(200).send({
    ok: true,
    rideId,
  });
});

app.get("/v1/rides", async (request) => {
  const { limit } = ridesQuerySchema.parse(request.query);
  return {
    rides: await listRides(limit),
  };
});

app.get("/v1/rides/:rideId", async (request, reply) => {
  const { rideId } = rideParamsSchema.parse(request.params);
  const ride = await getRide(rideId);

  if (!ride) {
    return reply.code(404).send({
      ok: false,
      message: "Ride not found",
    });
  }

  return ride;
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);

  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      ok: false,
      message: "Invalid request body",
      issues: error.issues,
    });
  }

  if (error instanceof Error && error.message === "Ride not found") {
    return reply.code(404).send({
      ok: false,
      message: error.message,
    });
  }

  if (error instanceof Error && error.message === "Ride already finished") {
    return reply.code(409).send({
      ok: false,
      message: error.message,
    });
  }

  return reply.code(500).send({
    ok: false,
    message: "Internal server error",
  });
});

async function start() {
  try {
    await connectDatabase();
    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

const shutdown = async () => {
  await app.close();
  await disconnectDatabase();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await start();
