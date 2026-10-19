import { z } from "zod";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } from "@/db/schema/common";

/** Optional narrowing of an activity list by kind (action) and record type. */
export const activityFiltersSchema = z.object({
  action: z.enum(ACTIVITY_ACTIONS).optional(),
  entityType: z.enum(ACTIVITY_ENTITY_TYPES).optional(),
});
export type ActivityFilters = z.infer<typeof activityFiltersSchema>;
