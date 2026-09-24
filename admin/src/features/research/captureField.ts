// What the phone recorded alongside a capture: where it was taken and how fast
// the rider was going.
//
// The phone writes this into the `field` block of the `.skateresearch` header,
// so it travels with the recording the admin app has already downloaded and
// needs no endpoint of its own. Only the header is read, not the sample block.
//
// Everything here is defensive. The container format grew: captures taken
// before the GPS track existed carry no `track` and no locations at all, and a
// reader that throws on those would hide a perfectly good recording behind an
// error. A member that is missing or the wrong shape comes back as null, which
// the view reports as "not recorded".
import type {
  ResearchCaptureField,
  ResearchLocation,
  ResearchTrack,
  ResearchTrackFix,
} from "@skate-route-mapper/shared/researchContracts";
import { decodeRecordingHeader } from "@skate-route-mapper/shared/xiaoResearch";

export type CaptureField = {
  track: ResearchTrack | null;
  startLocation: ResearchLocation | null;
  endLocation: ResearchLocation | null;
};

/** What a capture that recorded none of this looks like. */
export const emptyCaptureField: CaptureField = {
  track: null,
  startLocation: null,
  endLocation: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function coordinate(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const latitude = finiteNumber(value.latitude);
  const longitude = finiteNumber(value.longitude);

  return latitude === null || longitude === null ? null : { latitude, longitude };
}

function location(value: unknown): ResearchLocation | null {
  const position = coordinate(value);

  if (!position || !isRecord(value)) {
    return null;
  }

  return {
    ...position,
    accuracy: finiteNumber(value.accuracy),
    altitude: finiteNumber(value.altitude),
    speed: finiteNumber(value.speed),
    timestamp: finiteNumber(value.timestamp) ?? 0,
  };
}

/** Fixes with a usable position, in the order the phone logged them. */
function trackFixes(value: unknown): ResearchTrackFix[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const position = coordinate(entry);

    if (!position || !isRecord(entry)) {
      return [];
    }

    return [
      {
        ...position,
        t: finiteNumber(entry.t) ?? 0,
        accuracy: finiteNumber(entry.accuracy),
        altitude: finiteNumber(entry.altitude),
        speed: finiteNumber(entry.speed),
        heading: finiteNumber(entry.heading),
      },
    ];
  });
}

function track(value: unknown): ResearchTrack | null {
  if (!isRecord(value)) {
    return null;
  }

  const fixes = trackFixes(value.fixes);
  const speed = isRecord(value.speed) ? (value.speed as ResearchTrack["speed"]) : null;

  if (fixes.length === 0 && !speed) {
    return null;
  }

  return {
    startedAt: finiteNumber(value.startedAt) ?? 0,
    endedAt: finiteNumber(value.endedAt),
    fixes,
    speed: speed ?? {
      fixCount: fixes.length,
      acceptedFixCount: 0,
      rejectedFixCount: 0,
      reportedFixCount: 0,
      reportedMeanMps: null,
      reportedMedianMps: null,
      reportedMinMps: null,
      reportedMaxMps: null,
      distanceMeters: 0,
      movingSeconds: 0,
      avgSpeedMps: 0,
      maxSpeedMps: 0,
      worstAccuracyMeters: null,
    },
    error: typeof value.error === "string" ? value.error : null,
  };
}

/**
 * Read the phone's field notes out of a stored recording.
 *
 * A recording that will not parse at all returns empty rather than throwing:
 * the signal analysis decodes the same bytes and reports that failure properly,
 * and one broken container should raise one error, not two.
 */
export function readCaptureField(bytes: Uint8Array): CaptureField {
  let field: unknown;

  try {
    field = (decodeRecordingHeader(bytes).meta as { field?: unknown }).field;
  } catch {
    return emptyCaptureField;
  }

  if (!isRecord(field)) {
    return emptyCaptureField;
  }

  const parsed = field as ResearchCaptureField;

  return {
    track: track(parsed.track),
    startLocation: location(parsed.startLocation),
    endLocation: location(parsed.endLocation),
  };
}
