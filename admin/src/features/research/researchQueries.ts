import { useQuery } from "@tanstack/react-query";
import { getResearchCaptureRecording } from "../../api/adminApi";
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
