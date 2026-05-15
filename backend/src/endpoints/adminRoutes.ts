import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdminAuth } from "../auth/index.js";
import { env } from "../config/env.js";
import * as AdminResources from "../features/adminResources/index.js";
import * as AdminUsers from "../features/adminUsers/index.js";
import * as Rides from "../features/rides/index.js";

const adminEntityParamsSchema = z.object({
  resourceName: z.string().min(1),
});

const adminEntityItemParamsSchema = adminEntityParamsSchema.extend({
  entityId: z.string().min(1),
});

const adminEntityListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

const entityPayloadSchema = z.record(z.string(), z.unknown());

const requireAdmin = async (
  request: Parameters<typeof requireAdminAuth>[0],
  reply: Parameters<typeof requireAdminAuth>[1]
) => {
  await requireAdminAuth(request, reply, env.ADMIN_API_KEY);
};

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post("/v1/admin/login", async (request, reply) => {
    const payload = AdminUsers.adminLoginSchema.parse(request.body);
    const session = await AdminUsers.loginAdminUser(payload.email, payload.password);

    return reply.code(200).send({
      ok: true,
      ...session,
    });
  });

  app.get("/v1/admin/resources", {
    preHandler: requireAdmin,
  }, async () => ({
    resources: AdminResources.getAdminResources(),
  }));

  app.get("/v1/admin/entities/:resourceName", {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const { resourceName } = adminEntityParamsSchema.parse(request.params);
    const pagination = adminEntityListQuerySchema.parse(request.query);
    const resourceContext = AdminResources.getAdminResource(resourceName);

    if (!resourceContext) {
      return reply.code(404).send({
        ok: false,
        message: "Admin resource not found",
      });
    }

    return AdminResources.listAdminEntity(
      resourceContext.resource,
      resourceContext.delegateName,
      pagination
    );
  });

  app.post("/v1/admin/entities/:resourceName", {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const { resourceName } = adminEntityParamsSchema.parse(request.params);
    const resourceContext = AdminResources.getAdminResource(resourceName);

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
      item: await AdminResources.createAdminEntity(resourceContext.resource, resourceContext.delegateName, payload),
    });
  });

  app.patch("/v1/admin/entities/:resourceName/:entityId", {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const { entityId, resourceName } = adminEntityItemParamsSchema.parse(request.params);
    const resourceContext = AdminResources.getAdminResource(resourceName);

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
      item: await AdminResources.updateAdminEntity(resourceContext.resource, resourceContext.delegateName, entityId, payload),
    };
  });

  app.delete("/v1/admin/entities/:resourceName/:entityId", {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const { entityId, resourceName } = adminEntityItemParamsSchema.parse(request.params);
    const resourceContext = AdminResources.getAdminResource(resourceName);

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

    await AdminResources.deleteAdminEntity(resourceContext.resource, resourceContext.delegateName, entityId);

    return {
      ok: true,
    };
  });

  app.get("/v1/admin/users", {
    preHandler: requireAdmin,
  }, async () => ({
    items: await AdminUsers.listAdminUsers(),
  }));

  app.post("/v1/admin/users", {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const payload = AdminUsers.adminUserCreateSchema.parse(request.body);
    const adminUser = await AdminUsers.createAdminUser(payload);

    return reply.code(201).send({
      item: adminUser,
    });
  });

  app.patch("/v1/admin/users/:adminUserId", {
    preHandler: requireAdmin,
  }, async (request) => {
    const { adminUserId } = AdminUsers.adminUserParamsSchema.parse(request.params);
    const payload = AdminUsers.adminUserUpdateSchema.parse(request.body);

    return {
      item: await AdminUsers.updateAdminUser(adminUserId, payload),
    };
  });

  app.get("/v1/admin/rides", {
    preHandler: requireAdmin,
  }, async (request) => {
    const { limit } = Rides.ridesQuerySchema.parse(request.query);

    return {
      rides: await Rides.listRides(limit),
    };
  });

  app.get("/v1/admin/rides/:rideId", {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const { rideId } = Rides.rideParamsSchema.parse(request.params);
    const query = Rides.rideDetailQuerySchema.parse(request.query);
    const ride = await Rides.getRide(rideId, query);

    if (!ride) {
      return reply.code(404).send({
        ok: false,
        message: "Ride not found",
      });
    }

    return ride;
  });

  app.post("/v1/admin/mobile/rides/start", {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const payload = Rides.rideStartSchema.parse(request.body);
    await Rides.createRide(payload);

    return reply.code(201).send({
      ok: true,
      rideId: payload.rideId,
    });
  });

  app.post("/v1/admin/mobile/rides/:rideId/samples", {
    preHandler: requireAdmin,
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

  app.post("/v1/admin/mobile/rides/:rideId/finish", {
    preHandler: requireAdmin,
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
