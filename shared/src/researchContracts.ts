/**
 * The vocabulary of a capture's `category` column.
 *
 * Shared because both apps write it: the phone offers these when a rider files
 * a capture, and the admin app offers the same list when correcting one. A
 * category typed freehand in either place would quietly split a group in two
 * and there would be nothing in the data to say the two halves belong together.
 */
export const researchCategories = [
  { value: "airborne-contact", label: "Airborne / road contact" },
  { value: "smooth-asphalt", label: "Smooth asphalt" },
  { value: "rough-asphalt", label: "Rough asphalt" },
  { value: "paving-joints", label: "Paving / joints" },
  { value: "isolated-bump", label: "Bump / obstacle" },
  { value: "other", label: "Other experiment" },
] as const;

export type ResearchCategory = (typeof researchCategories)[number]["value"];

/** The label a rider saw for a stored category, or the raw value if it is unknown. */
export function researchCategoryLabel(value: string) {
  return researchCategories.find((category) => category.value === value)?.label ?? value;
}

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

/**
 * One phone position report taken while the board was recording.
 *
 * Deliberately small, with values rounded to the precision the sensors
 * actually have: the whole track travels inside the `.skateresearch` header,
 * which the shared codec refuses above 64 kB.
 */
export type ResearchTrackFix = {
  /** Phone clock in milliseconds, for the moment the fix describes. */
  t: number;
  latitude: number;
  longitude: number;
  /** Horizontal accuracy in metres, or null when the platform gave none. */
  accuracy: number | null;
  altitude: number | null;
  /** Ground speed in m/s as the platform reported it; null when unreported. */
  speed: number | null;
  heading: number | null;
};

/**
 * How fast the rider was going over the capture window.
 *
 * Both answers are kept because they fail differently. The reported figures
 * come from the platform's own ground speed, which is Doppler-derived and the
 * better measurement over a short run; the distance-based ones come from the
 * same filter and maths a ride uses, and are the cross-check that says whether
 * the reported speeds were plausible at all.
 */
export type ResearchTrackSpeed = {
  fixCount: number;
  /** Fixes the shared ride filter kept. */
  acceptedFixCount: number;
  rejectedFixCount: number;
  /** Fixes that carried a usable platform speed. */
  reportedFixCount: number;
  reportedMeanMps: number | null;
  reportedMedianMps: number | null;
  reportedMinMps: number | null;
  reportedMaxMps: number | null;
  distanceMeters: number;
  movingSeconds: number;
  /** Distance over moving time. */
  avgSpeedMps: number;
  maxSpeedMps: number;
  /** Worst horizontal accuracy over the window, in metres. */
  worstAccuracyMeters: number | null;
};

/**
 * The phone's GPS log for exactly the window the board was recording.
 *
 * Bounded to that window on purpose: the transfer that follows a capture can
 * run for minutes with the rider standing still, and those fixes would flatten
 * every speed figure the capture is judged by.
 */
export type ResearchTrack = {
  /** Phone clock when logging started, just before the board was told to record. */
  startedAt: number;
  /** Phone clock when logging stopped, i.e. the end of the capture window. */
  endedAt: number | null;
  fixes: ResearchTrackFix[];
  speed: ResearchTrackSpeed;
  /** Why the track is thin or empty, when it is. */
  error: string | null;
};

export type ResearchLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  timestamp: number;
};

/**
 * What the phone knew about a capture, as written into the `field` block of the
 * `.skateresearch` header and into the stored capture's `metadata` column.
 *
 * Every member is optional because the format grew: captures taken before the
 * GPS track existed carry neither `track` nor the locations, and a reader must
 * treat a missing member as "not recorded" rather than as an error.
 */
export type ResearchCaptureField = {
  collectionId?: string;
  category?: string;
  label?: string;
  note?: string;
  phoneCaptureRequestedAt?: number;
  transferMs?: number;
  /** A fix taken standing still, before the board was told to record. */
  startLocation?: ResearchLocation | null;
  /**
   * A fix taken when the capture was retrieved, which is after the recording
   * ended and after a transfer that can run for minutes. Context, not the end
   * of the capture: for that, and for speed, use `track`.
   */
  endLocation?: ResearchLocation | null;
  /** The phone's GPS log for the capture window. */
  track?: ResearchTrack | null;
  photoFilename?: string | null;
};
