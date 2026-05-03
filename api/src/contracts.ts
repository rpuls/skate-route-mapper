import { z } from "zod";

const vehicleTypeSchema = z.enum(["skates", "skateboard", "longboard"]);
const sensorSourceSchema = z.enum(["phone", "external"]);

export const measurementSampleSchema = z.object({
  timestamp: z.number().int().nonnegative(),
  ax: z.number(),
  ay: z.number(),
  az: z.number(),
  gx: z.number(),
  gy: z.number(),
  gz: z.number(),
  vibrationMagnitude: z.number().nonnegative(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  speed: z.number().nullable(),
});

export const rideStartSchema = z.object({
  rideId: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  vehicleType: vehicleTypeSchema,
  sensorSource: sensorSourceSchema,
  clientId: z.string().min(1).optional(),
  appVersion: z.string().min(1).optional(),
  deviceModel: z.string().min(1).optional(),
});

export const rideSamplesSchema = z.object({
  samples: z.array(measurementSampleSchema).min(1).max(1000),
});

export const rideFinishSchema = z.object({
  endedAt: z.number().int().nonnegative(),
});
