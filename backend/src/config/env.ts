import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CORS_ORIGIN: z.string().default("*"),
  MOBILE_INGESTION_API_KEY: z.string().min(16, "MOBILE_INGESTION_API_KEY must be at least 16 characters"),
  ADMIN_API_KEY: z.string().min(16, "ADMIN_API_KEY must be at least 16 characters"),
  INIT_ADMIN_EMAIL: z.string().email().optional(),
  INIT_ADMIN_PASSWORD: z.string().min(12, "INIT_ADMIN_PASSWORD must be at least 12 characters").optional(),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
}).superRefine((env, ctx) => {
  if ((env.INIT_ADMIN_EMAIL && !env.INIT_ADMIN_PASSWORD) || (!env.INIT_ADMIN_EMAIL && env.INIT_ADMIN_PASSWORD)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "INIT_ADMIN_EMAIL and INIT_ADMIN_PASSWORD must be provided together",
      path: ["INIT_ADMIN_EMAIL"],
    });
  }
});

export const env = envSchema.parse(process.env);
