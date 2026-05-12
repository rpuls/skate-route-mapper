import { z } from "zod";

export const acceptedVehicleTypes = ["skates", "skateboard", "longboard"] as const;
export const acceptedSensorSources = ["phone", "external"] as const;

const vehicleTypeSchema = z.enum(acceptedVehicleTypes);
const sensorSourceSchema = z.enum(acceptedSensorSources);

export const rideParamsSchema = z.object({
  rideId: z.string().min(1),
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
  locationTimestamp: z.number().int().nonnegative().nullable().optional(),
  locationAccuracy: z.number().nonnegative().nullable().optional(),
  locationAgeMs: z.number().int().nonnegative().nullable().optional(),
});

export const rideSamplesSchema = z.object({
  samples: z.array(measurementSampleSchema).min(1).max(1000),
});

export const rideFinishSchema = z.object({
  endedAt: z.number().int().nonnegative(),
});

export const ridesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
});
