import { z } from "zod";

const base64Schema = z.string().min(1).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const researchCaptureUploadSchema = z.object({
  collectionId: z.string().uuid(),
  captureId: z.number().int().min(0).max(0xffffffff),
  createdAt: z.number().int().nonnegative(),
  category: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  note: z.string().max(4000),
  durationSeconds: z.union([z.literal(10), z.literal(30), z.literal(60)]),
  rateHz: z.union([z.literal(833), z.literal(1666)]),
  sampleCount: z.number().int().positive().max(99960),
  metadata: z.record(z.string(), z.unknown()),
  recordingBase64: base64Schema.max(2_000_000),
  photoBase64: base64Schema.max(8_000_000).nullable(),
  photoContentType: z.literal("image/jpeg").nullable(),
}).superRefine((value, context) => {
  if ((value.photoBase64 === null) !== (value.photoContentType === null)) {
    context.addIssue({
      code: "custom",
      path: ["photoBase64"],
      message: "Photo bytes and content type must be provided together",
    });
  }
});

export const researchCaptureParamsSchema = z.object({
  researchCaptureId: z.string().uuid(),
});
