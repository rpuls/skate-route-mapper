export const researchCategories = [
  { value: "airborne-contact", label: "Airborne / road contact" },
  { value: "smooth-asphalt", label: "Smooth asphalt" },
  { value: "rough-asphalt", label: "Rough asphalt" },
  { value: "paving-joints", label: "Paving / joints" },
  { value: "isolated-bump", label: "Bump / obstacle" },
  { value: "other", label: "Other experiment" },
] as const;

export type ResearchCategory = (typeof researchCategories)[number]["value"];

export type ResearchLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  timestamp: number;
};

export type ResearchCollection = {
  id: string;
  captureId: number;
  createdAt: number;
  category: ResearchCategory;
  label: string;
  note: string;
  durationSeconds: 10 | 30 | 60;
  rateHz: 833 | 1666;
  sampleCount: number;
  recordingUri: string;
  photoUri: string | null;
  startLocation: ResearchLocation;
  endLocation: ResearchLocation | null;
  transferMs: number;
  report: Record<string, unknown>;
  uploadedAt?: number | null;
  serverCaptureId?: string | null;
  uploadError?: string | null;
};
