export const queryKeys = {
  adminResources: ["admin", "resources"] as const,
  entityRecords: (resourceName: string) => ["admin", "entities", resourceName] as const,
};
