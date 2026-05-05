import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { env } from "./config/env.js";
import { registerAdminRoutes } from "./endpoints/adminRoutes.js";
import { registerHealthRoute } from "./endpoints/healthRoute.js";
import { registerMobileRoutes } from "./endpoints/mobileRoutes.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
  });

  await registerHealthRoute(app);
  await registerAdminRoutes(app);
  await registerMobileRoutes(app);

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

    if (error instanceof Error && error.message === "Record not found") {
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

    if (error instanceof Error && error.message === "Invalid admin credentials") {
      return reply.code(401).send({
        ok: false,
        message: error.message,
      });
    }

    if (error instanceof Error && error.message === "Admin password must be at least 12 characters") {
      return reply.code(400).send({
        ok: false,
        message: error.message,
      });
    }

    if (error instanceof Error && "code" in error && error.code === "P2002") {
      return reply.code(409).send({
        ok: false,
        message: "A record with that unique value already exists",
      });
    }

    if (error instanceof Error && "code" in error && error.code === "P2025") {
      return reply.code(404).send({
        ok: false,
        message: "Record not found",
      });
    }

    return reply.code(500).send({
      ok: false,
      message: "Internal server error",
    });
  });

  return app;
}
