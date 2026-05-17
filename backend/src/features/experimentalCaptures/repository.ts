import { prisma } from "../../db/prisma.js";
import type { ExperimentalCapturePayload } from "./contracts.js";

type ExperimentalCaptureDelegate = {
  create: (args: unknown) => Promise<{ id: string }>;
  findMany: (args: unknown) => Promise<unknown[]>;
  findUnique: (args: unknown) => Promise<unknown | null>;
};

function experimentalCaptureDelegate() {
  return (prisma as unknown as {
    experimentalCapture: ExperimentalCaptureDelegate;
  }).experimentalCapture;
}

export async function createExperimentalCapture(
  payload: ExperimentalCapturePayload,
  options: {
    userId?: string | null;
  } = {}
) {
  return experimentalCaptureDelegate().create({
    data: {
      userId: options.userId ?? null,
      payload: payload.payload,
    },
    select: {
      id: true,
    },
  });
}

export async function listExperimentalCaptures(limit: number) {
  return experimentalCaptureDelegate().findMany({
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      userId: true,
      createdAt: true,
    },
    take: limit,
  });
}

export async function getExperimentalCapture(captureId: string) {
  return experimentalCaptureDelegate().findUnique({
    where: {
      id: captureId,
    },
  });
}
