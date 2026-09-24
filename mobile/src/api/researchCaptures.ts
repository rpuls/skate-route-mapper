import { File } from "expo-file-system";
import type {
  ResearchCaptureUpload,
  ResearchCaptureUploadResponse,
} from "@skate-route-mapper/shared/researchContracts";
import type { ResearchCollection } from "../types/research";
import { mobileApiBaseUrl } from "./config";

export async function uploadResearchCapture(collection: ResearchCollection, token: string) {
  const recordingBase64 = await new File(collection.recordingUri).base64();
  const photoBase64 = collection.photoUri
    ? await new File(collection.photoUri).base64()
    : null;
  const payload: ResearchCaptureUpload = {
    collectionId: collection.id,
    captureId: collection.captureId,
    createdAt: collection.createdAt,
    category: collection.category,
    label: collection.label,
    note: collection.note,
    durationSeconds: collection.durationSeconds,
    rateHz: collection.rateHz,
    sampleCount: collection.sampleCount,
    metadata: {
      startLocation: collection.startLocation,
      endLocation: collection.endLocation,
      // The phone's GPS log for the capture window, so a laptop analysing the
      // uploaded recording can normalise roughness for speed without the
      // original phone.
      track: collection.track ?? null,
      transferMs: collection.transferMs,
      report: collection.report,
    },
    recordingBase64,
    photoBase64,
    photoContentType: photoBase64 ? "image/jpeg" : null,
  };

  const response = await fetch(`${mobileApiBaseUrl}/v1/mobile/research-captures`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(typeof body?.message === "string" ? body.message : "Unable to upload research capture.");
  }
  return body as ResearchCaptureUploadResponse;
}
