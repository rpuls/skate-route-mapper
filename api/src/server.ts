import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { getAdminResource, getAdminResources } from "./adminResources.js";
import { requireAdminAuth, requireApiKey } from "./auth.js";
import { env } from "./config.js";
import {
  appendSamples,
  connectDatabase,
  createAdminEntity,
  createAdminUser,
  createRide,
  deleteAdminEntity,
  disconnectDatabase,
  finishRide,
  getRide,
  listAdminEntity,
  listAdminUsers,
  listRides,
  loginAdminUser,
  seedInitialAdminUser,
  updateAdminEntity,
  updateAdminUser,
} from "./db.js";
import {
  adminLoginSchema,
  adminUserCreateSchema,
  adminUserUpdateSchema,
  rideFinishSchema,
  rideSamplesSchema,
  rideStartSchema,
} from "./contracts.js";

const rideParamsSchema = z.object({
  rideId: z.string().min(1),
});

const adminUserParamsSchema = z.object({
  adminUserId: z.string().min(1),
});

const adminEntityParamsSchema = z.object({
  resourceName: z.string().min(1),
});

const adminEntityItemParamsSchema = adminEntityParamsSchema.extend({
  entityId: z.string().min(1),
});

const entityPayloadSchema = z.record(z.string(), z.unknown());

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

app.post("/v1/admin/login", async (request, reply) => {
  const payload = adminLoginSchema.parse(request.body);
  const session = await loginAdminUser(payload.email, payload.password);

  return reply.code(200).send({
    ok: true,
    ...session,
  });
});

app.get("/v1/admin/resources", {
  preHandler: async (request, reply) => {
    await requireAdminAuth(request, reply, env.ADMIN_API_KEY);
  },
}, async () => ({
  resources: getAdminResources(),
}));

app.get("/v1/admin/entities/:resourceName", {
  preHandler: async (request, reply) => {
    await requireAdminAuth(request, reply, env.ADMIN_API_KEY);
  },
}, async (request, reply) => {
  const { resourceName } = adminEntityParamsSchema.parse(request.params);
  const resourceContext = getAdminResource(resourceName);

  if (!resourceContext) {
    return reply.code(404).send({
      ok: false,
      message: "Admin resource not found",
    });
  }

  return {
    items: await listAdminEntity(resourceContext.resource, resourceContext.delegateName),
  };
});

app.post("/v1/admin/entities/:resourceName", {
  preHandler: async (request, reply) => {
    await requireAdminAuth(request, reply, env.ADMIN_API_KEY);
  },
}, async (request, reply) => {
  const { resourceName } = adminEntityParamsSchema.parse(request.params);
  const resourceContext = getAdminResource(resourceName);

  if (!resourceContext) {
    return reply.code(404).send({
      ok: false,
      message: "Admin resource not found",
    });
  }

  if (!resourceContext.resource.canCreate) {
    return reply.code(405).send({
      ok: false,
      message: "Admin resource does not allow creation",
    });
  }

  const payload = entityPayloadSchema.parse(request.body);

  return reply.code(201).send({
    item: await createAdminEntity(resourceContext.resource, resourceContext.delegateName, payload),
  });
});

app.patch("/v1/admin/entities/:resourceName/:entityId", {
  preHandler: async (request, reply) => {
    await requireAdminAuth(request, reply, env.ADMIN_API_KEY);
  },
}, async (request, reply) => {
  const { entityId, resourceName } = adminEntityItemParamsSchema.parse(request.params);
  const resourceContext = getAdminResource(resourceName);

  if (!resourceContext) {
    return reply.code(404).send({
      ok: false,
      message: "Admin resource not found",
    });
  }

  if (!resourceContext.resource.canEdit) {
    return reply.code(405).send({
      ok: false,
      message: "Admin resource does not allow edits",
    });
  }

  const payload = entityPayloadSchema.parse(request.body);

  return {
    item: await updateAdminEntity(resourceContext.resource, resourceContext.delegateName, entityId, payload),
  };
});

app.delete("/v1/admin/entities/:resourceName/:entityId", {
  preHandler: async (request, reply) => {
    await requireAdminAuth(request, reply, env.ADMIN_API_KEY);
  },
}, async (request, reply) => {
  const { entityId, resourceName } = adminEntityItemParamsSchema.parse(request.params);
  const resourceContext = getAdminResource(resourceName);

  if (!resourceContext) {
    return reply.code(404).send({
      ok: false,
      message: "Admin resource not found",
    });
  }

  if (!resourceContext.resource.canDelete) {
    return reply.code(405).send({
      ok: false,
      message: "Admin resource does not allow deletion",
    });
  }

  await deleteAdminEntity(resourceContext.resource, resourceContext.delegateName, entityId);

  return {
    ok: true,
  };
});

app.get("/v1/admin/users", {
  preHandler: async (request, reply) => {
    await requireAdminAuth(request, reply, env.ADMIN_API_KEY);
  },
}, async () => ({
  items: await listAdminUsers(),
}));

app.post("/v1/admin/users", {
  preHandler: async (request, reply) => {
    await requireAdminAuth(request, reply, env.ADMIN_API_KEY);
  },
}, async (request, reply) => {
  const payload = adminUserCreateSchema.parse(request.body);
  const adminUser = await createAdminUser(payload);

  return reply.code(201).send({
    item: adminUser,
  });
});

app.patch("/v1/admin/users/:adminUserId", {
  preHandler: async (request, reply) => {
    await requireAdminAuth(request, reply, env.ADMIN_API_KEY);
  },
}, async (request) => {
  const { adminUserId } = adminUserParamsSchema.parse(request.params);
  const payload = adminUserUpdateSchema.parse(request.body);

  return {
    item: await updateAdminUser(adminUserId, payload),
  };
});

app.post("/v1/rides/start", {
  preHandler: (request, reply, done) => {
    if (requireApiKey(request, reply, env.MOBILE_INGESTION_API_KEY, "ingestion")) {
      done();
    }
  },
}, async (request, reply) => {
  const payload = rideStartSchema.parse(request.body);
  await createRide(payload);
  return reply.code(201).send({
    ok: true,
    rideId: payload.rideId,
  });
});

app.post("/v1/rides/:rideId/samples", {
  preHandler: (request, reply, done) => {
    if (requireApiKey(request, reply, env.MOBILE_INGESTION_API_KEY, "ingestion")) {
      done();
    }
  },
}, async (request, reply) => {
  const { rideId } = rideParamsSchema.parse(request.params);
  const payload = rideSamplesSchema.parse(request.body);
  await appendSamples(rideId, payload.samples);
  return reply.code(202).send({
    ok: true,
    rideId,
    accepted: payload.samples.length,
  });
});

app.post("/v1/rides/:rideId/finish", {
  preHandler: (request, reply, done) => {
    if (requireApiKey(request, reply, env.MOBILE_INGESTION_API_KEY, "ingestion")) {
      done();
    }
  },
}, async (request, reply) => {
  const { rideId } = rideParamsSchema.parse(request.params);
  const payload = rideFinishSchema.parse(request.body);
  await finishRide(rideId, payload.endedAt);
  return reply.code(200).send({
    ok: true,
    rideId,
  });
});

app.get("/v1/rides", {
  preHandler: async (request, reply) => {
    await requireAdminAuth(request, reply, env.ADMIN_API_KEY);
  },
}, async (request) => {
  const { limit } = ridesQuerySchema.parse(request.query);
  return {
    rides: await listRides(limit),
  };
});

app.get("/v1/rides/:rideId", {
  preHandler: async (request, reply) => {
    await requireAdminAuth(request, reply, env.ADMIN_API_KEY);
  },
}, async (request, reply) => {
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

async function start() {
  try {
    await connectDatabase();
    const seededAdmin = await seedInitialAdminUser();

    if (seededAdmin) {
      app.log.info({ adminUserId: seededAdmin.id, email: seededAdmin.email }, "Seeded initial admin user");
    }

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
