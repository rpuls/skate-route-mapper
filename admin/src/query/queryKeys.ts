export const queryKeys = {
  adminResources: ["admin", "resources"] as const,
  entityRecords: (resourceName: string, page?: number, pageSize?: number) =>
    page && pageSize
      ? (["admin", "entities", resourceName, { page, pageSize }] as const)
      : (["admin", "entities", resourceName] as const),
  rideDetail: (rideId: string) => ["admin", "rides", rideId] as const,
};
