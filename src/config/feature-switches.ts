import { z } from "zod";

/**
 * MCP, stock adjustments and multi-bin runs are not ready yet: they still lack
 * testing and concept work, so they are off on staging and production until
 * they are finished. Local development and CI explicitly enable them.
 * Shared by full server validation and the private environment accessors.
 */
export const featureEnabledSchema = z.enum(["true", "false"]).default("false").transform(value => value === "true");
