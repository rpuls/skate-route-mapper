import { z } from "zod";
import { maxSamplesPerSyncOperation } from "@skate-route-mapper/shared/mobileContracts";

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
  ax: z.number().nullable(),
  ay: z.number().nullable(),
  az: z.number().nullable(),
  gx: z.number().nullable(),
  gy: z.number().nullable(),
  gz: z.number().nullable(),
  vibrationMagnitude: z.number().nonnegative().nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  speed: z.number().nullable(),
  locationTimestamp: z.number().int().nonnegative().nullable().optional(),
  locationAccuracy: z.number().nonnegative().nullable().optional(),
  locationAgeMs: z.number().int().nonnegative().nullable().optional(),
});

export const rideSamplesSchema = z.object({
  samples: z.array(measurementSampleSchema).min(1).max(maxSamplesPerSyncOperation),
});

// What the phone measured while it was recording. The backend recomputes the
// same figures from the synced samples and prefers its own, so these are a
// fallback for a ride whose samples never made it up.
export const rideMetricsSchema = z.object({
  distanceMeters: z.number().nonnegative(),
  movingSeconds: z.number().nonnegative(),
  maxSpeedMps: z.number().nonnegative(),
});

export const rideFinishSchema = z.object({
  endedAt: z.number().int().nonnegative(),
  metrics: rideMetricsSchema.optional(),
});

export const ridesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
});

export const rideDetailQuerySchema = z.object({
  sampleLimit: z.coerce.number().int().positive().max(5000).default(5000),
  sampleOffset: z.coerce.number().int().nonnegative().default(0),
});
