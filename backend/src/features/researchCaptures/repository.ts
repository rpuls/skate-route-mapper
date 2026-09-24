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

/**
 * Every stored capture except the bytes, newest first.
 *
 * This is the dataset the road surface work is built on, so it carries the
 * whole `metadata` column rather than the trimmed view the entity viewer gets:
 * the GPS track, the speed summary over the recording window and the board's
 * own report all live in there, and a roughness figure cannot be normalised
 * without them.
 *
 * Recordings and photos are fetched per capture through the existing asset
 * endpoints instead of being inlined here. A page of base64 blobs would be tens
 * of megabytes, could not be resumed, and would be re-sent in full every time
 * one capture changed.
 *
 * Paged for the same reason every other admin list is: the caller loops rather
 * than assuming one response holds the lot.
 */
export async function listResearchCaptureExport(page: { limit: number; offset: number }) {
  const [rows, total] = await Promise.all([
    prisma.researchCapture.findMany({
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        userId: true,
        captureId: true,
        capturedAt: true,
        category: true,
        label: true,
        note: true,
        durationSeconds: true,
        rateHz: true,
        sampleCount: true,
        metadata: true,
        photoContentType: true,
        createdAt: true,
        updatedAt: true,
      },
      skip: page.offset,
      take: page.limit,
    }),
    prisma.researchCapture.count(),
  ]);

  return {
    total,
    captures: rows.map((row) => ({
      ...row,
      // The board's capture id is a uint32, so a number is exact here and is
      // what an analysis script wants. Dates go out as ISO strings.
      captureId: Number(row.captureId),
      capturedAt: row.capturedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      hasPhoto: row.photoContentType !== null,
    })),
  };
}
