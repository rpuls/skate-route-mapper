import type { RideMetricsPayload } from "@skate-route-mapper/shared/mobileContracts";
import {
  rideMetricsFromSamples,
  type LocatedSample,
} from "@skate-route-mapper/shared/rideTracking";

/** The route columns stored on a finished ride. */
export type RideMetricColumns = {
  distanceMeters: number;
  movingSeconds: number;
  avgSpeedMps: number;
  maxSpeedMps: number;
  acceptedFixCount: number;
  rejectedFixCount: number;
};

/**
 * Decide what a finished ride covered.
 *
 * The server recomputes from the samples it actually holds rather than
 * trusting the phone, so the stored figures always match the stored route, and
 * changing the algorithm later means re-running it over data that is already
 * there.
 *
 * The phone's own numbers are the fallback for a ride the server has no
 * position data for at all — one whose samples never synced still deserves a
 * distance rather than a zero. A ride that has fixes but simply did not move
 * is not that case: its recomputed zero is the right answer, and the reported
 * figures must not override it.
 */
export function rideMetricColumns(params: {
  samples: readonly LocatedSample[];
  startedAt: number;
  endedAt: number;
  reportedMetrics?: RideMetricsPayload | undefined;
}): RideMetricColumns {
  if (params.samples.length === 0 && params.reportedMetrics) {
    const reported = params.reportedMetrics;

    return {
      distanceMeters: reported.distanceMeters,
      movingSeconds: reported.movingSeconds,
      avgSpeedMps:
        reported.movingSeconds > 0 ? reported.distanceMeters / reported.movingSeconds : 0,
      maxSpeedMps: reported.maxSpeedMps,
      // The server saw no fixes, so it cannot honestly claim to have kept any.
      acceptedFixCount: 0,
      rejectedFixCount: 0,
    };
  }

  const metrics = rideMetricsFromSamples(params.samples, {
    startedAt: params.startedAt,
    endedAt: params.endedAt,
  });

  return {
    distanceMeters: metrics.distanceMeters,
    movingSeconds: metrics.movingSeconds,
    avgSpeedMps: metrics.avgSpeedMps,
    maxSpeedMps: metrics.maxSpeedMps,
    acceptedFixCount: metrics.acceptedFixCount,
    rejectedFixCount: metrics.rejectedFixCount,
  };
}
