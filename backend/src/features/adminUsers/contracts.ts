import { z } from "zod";

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const adminUserCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().trim().min(1).optional(),
  active: z.boolean().default(true),
});

export const adminUserUpdateSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(12).optional(),
  name: z.string().trim().min(1).nullable().optional(),
  active: z.boolean().optional(),
});

export const adminUserParamsSchema = z.object({
  adminUserId: z.string().min(1),
});
