import { Prisma } from "../../../generated/prisma/index.js";
import { prisma } from "../../db/prisma.js";
import type { ResearchCaptureUpload } from "@skate-route-mapper/shared/researchContracts";
import { decodeRecording } from "@skate-route-mapper/shared/xiaoResearch";

type Upload = ResearchCaptureUpload;

function validateRecording(value: string, payload: Pick<Upload, "captureId" | "rateHz" | "sampleCount">) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > 1_100_000) throw new Error("Research recording is too large");
  try {
    const decoded = decodeRecording(new Uint8Array(bytes));
    if (decoded.meta.captureId !== payload.captureId || decoded.meta.rateHz !== payload.rateHz ||
        decoded.meta.count !== payload.sampleCount) {
      throw new Error("Metadata mismatch");
    }
  } catch {
    throw new Error("Invalid research recording");
  }
  return bytes;
}

export async function saveResearchCapture(payload: Upload, userId: string) {
  const recording = validateRecording(payload.recordingBase64, payload);
  const photo = payload.photoBase64 ? Buffer.from(payload.photoBase64, "base64") : null;
  const captureId = BigInt(payload.captureId);
  if (photo && photo.length > 6_000_000) throw new Error("Research photo is too large");

  const existing = await prisma.researchCapture.findUnique({
    where: { id: payload.collectionId },
    select: { userId: true, captureId: true, rateHz: true, sampleCount: true },
  });
  if (existing && existing.userId !== userId) throw new Error("Research capture access denied");
  if (existing && (existing.captureId !== captureId || existing.rateHz !== payload.rateHz ||
      existing.sampleCount !== payload.sampleCount)) {
    throw new Error("Research capture identity mismatch");
  }

  const saved = await prisma.researchCapture.upsert({
    where: { id: payload.collectionId },
    update: {
      category: payload.category,
      label: payload.label,
      note: payload.note,
      metadata: payload.metadata as Prisma.InputJsonValue,
      recording,
      photo,
      photoContentType: payload.photoContentType,
    },
    create: {
      id: payload.collectionId,
      userId,
      captureId,
      capturedAt: new Date(payload.createdAt),
      category: payload.category,
      label: payload.label,
      note: payload.note,
      durationSeconds: payload.durationSeconds,
      rateHz: payload.rateHz,
      sampleCount: payload.sampleCount,
      metadata: payload.metadata as Prisma.InputJsonValue,
      recording,
      photo,
      photoContentType: payload.photoContentType,
    },
    select: { id: true },
  });

  return {
    id: saved.id,
    recordingBytes: recording.length,
    photoBytes: photo?.length ?? 0,
  };
}

export function getResearchCaptureAsset(id: string) {
  return prisma.researchCapture.findUnique({
    where: { id },
    select: {
      id: true,
      captureId: true,
      recording: true,
      photo: true,
      photoContentType: true,
    },
  });
}
