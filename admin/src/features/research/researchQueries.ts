import { useQuery } from "@tanstack/react-query";
import {
  getResearchCapturePhoto,
  getResearchCaptureRecording,
} from "../../api/adminApi";
import { queryKeys } from "../../query/queryKeys";
import type { AdminSession } from "../../types";

/**
 * Fetches the stored .skateresearch container for a capture. Recordings are
 * immutable once uploaded and at most about a megabyte, so they stay cached for
 * the session rather than being re-fetched while an admin flicks between rows.
 */
export function useResearchCaptureRecording(
  session: AdminSession,
  researchCaptureId: string | null
) {
  return useQuery({
    enabled: Boolean(researchCaptureId),
    queryKey: queryKeys.researchCaptureRecording(researchCaptureId ?? "none"),
    queryFn: () => {
      if (!researchCaptureId) {
        throw new Error("No research capture selected");
      }

      return getResearchCaptureRecording(session, researchCaptureId);
    },
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * Fetches the stored surface photo so the view can show it inline.
 *
 * The asset endpoint is behind the admin bearer token, which an `<img src>`
 * cannot send, so the bytes come back as a blob and the view owns the object
 * URL it makes from them. Only enabled for a capture that has a photo, since a
 * capture without one answers 404.
 */
export function useResearchCapturePhoto(
  session: AdminSession,
  researchCaptureId: string | null,
  hasPhoto: boolean
) {
  return useQuery({
    enabled: Boolean(researchCaptureId) && hasPhoto,
    queryKey: queryKeys.researchCapturePhoto(researchCaptureId ?? "none"),
    queryFn: () => {
      if (!researchCaptureId) {
        throw new Error("No research capture selected");
      }

      return getResearchCapturePhoto(session, researchCaptureId);
    },
    staleTime: Infinity,
    retry: false,
  });
}
