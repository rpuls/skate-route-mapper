import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdminAuth } from "../auth/index.js";
import { env } from "../config/env.js";
import * as AdminResources from "../features/adminResources/index.js";
import * as AdminUsers from "../features/adminUsers/index.js";
import * as Rides from "../features/rides/index.js";
import * as ResearchCaptures from "../features/researchCaptures/index.js";

const adminEntityParamsSchema = z.object({
  resourceName: z.string().min(1),
});

const adminEntityItemParamsSchema = adminEntityParamsSchema.extend({
  entityId: z.string().min(1),
});

const adminEntityListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  // The column an admin clicked. It is checked against the resource's own
  // listed fields before it reaches Prisma, so an unknown name orders by id
  // rather than failing the request.
  sortField: z.string().min(1).max(64).optional(),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
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
    const query = adminEntityListQuerySchema.parse(request.query);
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
      {
        page: query.page,
        pageSize: query.pageSize,
        sort: query.sortField
          ? { field: query.sortField, direction: query.sortDirection }
          : null,
      }
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

  // Re-run the ride tracking algorithm over a ride that is already stored.
  //
  // Rides recorded before ride tracking existed have no route figures at all,
  // and the thresholds it uses are reasoned rather than measured — they will be
  // tuned once there is real outdoor data. Both cases need a way to recompute
  // from samples the backend already holds.
  app.post("/v1/admin/rides/:rideId/recompute-metrics", {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const { rideId } = Rides.rideParamsSchema.parse(request.params);

    try {
      const metrics = await Rides.recomputeRideMetrics(rideId);

      return reply.code(200).send({
        ok: true,
        rideId,
        metrics,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Ride not found") {
        return reply.code(404).send({
          ok: false,
          message: "Ride not found",
        });
      }

      throw error;
    }
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
    await Rides.finishRide(rideId, payload.endedAt, {}, payload.metrics);

    return reply.code(200).send({
      ok: true,
      rideId,
    });
  });

  // The research dataset, for the offline road surface work. Metadata only:
  // the recordings and photos are fetched per capture through the two asset
  // endpoints below, so a fetch can be resumed and an unchanged capture is not
  // downloaded twice. scripts/fetch-research.mjs is the client.
  app.get("/v1/admin/research-captures/export", {
    preHandler: requireAdmin,
  }, async (request) => {
    const page = ResearchCaptures.researchCaptureExportQuerySchema.parse(request.query);
    const { captures, total } = await ResearchCaptures.listResearchCaptureExport(page);

    return {
      exportedAt: new Date().toISOString(),
      total,
      limit: page.limit,
      offset: page.offset,
      count: captures.length,
      captures,
    };
  });

  app.get("/v1/admin/research-captures/:researchCaptureId/recording", {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const { researchCaptureId } = ResearchCaptures.researchCaptureParamsSchema.parse(request.params);
    const capture = await ResearchCaptures.getResearchCaptureAsset(researchCaptureId);
    if (!capture) return reply.code(404).send({ ok: false, message: "Research capture not found" });
    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename=\"skate-research-${capture.captureId}.skateresearch\"`)
      .send(capture.recording);
  });

  app.get("/v1/admin/research-captures/:researchCaptureId/photo", {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const { researchCaptureId } = ResearchCaptures.researchCaptureParamsSchema.parse(request.params);
    const capture = await ResearchCaptures.getResearchCaptureAsset(researchCaptureId);
    if (!capture?.photo) return reply.code(404).send({ ok: false, message: "Research photo not found" });
    return reply.header("Content-Type", capture.photoContentType ?? "image/jpeg").send(capture.photo);
  });
}
