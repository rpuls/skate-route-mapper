export type ResearchCaptureUpload = {
  collectionId: string;
  captureId: number;
  createdAt: number;
  category: string;
  label: string;
  note: string;
  durationSeconds: number;
  rateHz: number;
  sampleCount: number;
  metadata: Record<string, unknown>;
  recordingBase64: string;
  photoBase64: string | null;
  photoContentType: "image/jpeg" | null;
};

export type ResearchCaptureUploadResponse = {
  ok: true;
  researchCaptureId: string;
  recordingBytes: number;
  photoBytes: number;
};
