export const documentKeys = {
  all: ["documents"] as const,
  forEntity: (entityType: string, entityId: string) =>
    [...documentKeys.all, entityType, entityId] as const,
};

