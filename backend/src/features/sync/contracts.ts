import { z } from "zod";
import {
  measurementSampleSchema,
  rideFinishSchema,
  rideStartSchema,
} from "../rides/contracts.js";

const syncOperationBaseSchema = z.object({
  operationId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});

export const syncOperationSchema = z.discriminatedUnion("type", [
  syncOperationBaseSchema.extend({
    type: z.literal("ride.start"),
    payload: rideStartSchema,
  }),
  syncOperationBaseSchema.extend({
    type: z.literal("ride.samples"),
    payload: z.object({
      rideId: z.string().min(1),
      samples: z.array(measurementSampleSchema).min(1).max(1000),
    }),
  }),
  syncOperationBaseSchema.extend({
    type: z.literal("ride.finish"),
    payload: z.object({
      rideId: z.string().min(1),
      endedAt: rideFinishSchema.shape.endedAt,
    }),
  }),
]);

export const syncRequestSchema = z.object({
  operations: z.array(syncOperationSchema).max(100),
  since: z.number().int().nonnegative().nullable().optional(),
});
