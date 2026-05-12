import { z } from "zod";

const mobileDeviceIdentitySchema = z.object({
  clientId: z.string().trim().min(1).optional(),
  deviceModel: z.string().trim().min(1).optional(),
  appVersion: z.string().trim().min(1).optional(),
});

export const mobileSignupSchema = mobileDeviceIdentitySchema.extend({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().min(1).optional(),
});

export const mobileLoginSchema = mobileDeviceIdentitySchema.extend({
  email: z.string().email(),
  password: z.string().min(1),
});

export const currentMobileUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).nullable(),
});

export const mobileAuthResponseSchema = z.object({
  ok: z.literal(true),
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  user: currentMobileUserSchema,
  deviceId: z.string().min(1).nullable(),
});
