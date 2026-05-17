import { z } from "zod";

export const experimentalCaptureSchema = z.object({
  payload: z.unknown().refine((value) => value !== undefined, {
    message: "Required",
  }),
});

export const experimentalCapturesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
});

export const experimentalCaptureParamsSchema = z.object({
  captureId: z.string().min(1),
});

export type ExperimentalCapturePayload = z.infer<typeof experimentalCaptureSchema>;
