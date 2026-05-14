export const queryKeys = {
  adminResources: ["admin", "resources"] as const,
  entityRecords: (resourceName: string) => ["admin", "entities", resourceName] as const,
  rideDetail: (rideId: string) => ["admin", "rides", rideId] as const,
};
