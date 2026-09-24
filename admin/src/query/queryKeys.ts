import type { EntitySort } from "../types";

/**
 * Generic entity lists are paged and ordered by the API, so both belong in the
 * key: a page of rows sorted one way is not the same cached answer as the same
 * page sorted another. The resource name stays the first segment so a mutation
 * can invalidate every page and ordering of one resource at once.
 */
export const queryKeys = {
  adminResources: ["admin", "resources"] as const,
  entityRecords: (
    resourceName: string,
    query?: {
      page: number;
      pageSize: number;
      sort?: EntitySort | null;
    }
  ) =>
    query
      ? ([
          "admin",
          "entities",
          resourceName,
          {
            page: query.page,
            pageSize: query.pageSize,
            sort: query.sort ?? null,
          },
        ] as const)
      : (["admin", "entities", resourceName] as const),
  rideDetail: (rideId: string) => ["admin", "rides", rideId] as const,
  rides: ["admin", "entities", "rides"] as const,
  researchCaptureRecording: (researchCaptureId: string) =>
    ["admin", "research-captures", researchCaptureId, "recording"] as const,
  researchCapturePhoto: (researchCaptureId: string) =>
    ["admin", "research-captures", researchCaptureId, "photo"] as const,
};
