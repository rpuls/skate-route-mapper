// A capture's categories and its GPS track are shared contracts: the phone
// writes both, and the admin app reads them back and offers the same categories
// when correcting a capture. They live in shared and are re-exported here for
// the mobile code that has always imported them from this module.
export { researchCategories } from "@skate-route-mapper/shared/researchContracts";

export type { ResearchCategory } from "@skate-route-mapper/shared/researchContracts";

export type {
  ResearchLocation,
  ResearchTrack,
  ResearchTrackFix,
  ResearchTrackSpeed,
} from "@skate-route-mapper/shared/researchContracts";

import type {
  ResearchCategory,
  ResearchLocation,
  ResearchTrack,
} from "@skate-route-mapper/shared/researchContracts";

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
  /** A fix taken standing still, before the board was told to record. */
  startLocation: ResearchLocation;
  /**
   * A fix taken when the capture was retrieved, which is after the recording
   * ended and after a transfer that can run for minutes. Context, not the end
   * of the capture: for that, and for speed, use `track`.
   */
  endLocation: ResearchLocation | null;
  /**
   * The phone's GPS log for the capture window. Absent on collections saved
   * before the track was recorded, and null when GPS gave nothing.
   */
  track?: ResearchTrack | null;
  transferMs: number;
  report: Record<string, unknown>;
  uploadedAt?: number | null;
  serverCaptureId?: string | null;
  uploadError?: string | null;
};
