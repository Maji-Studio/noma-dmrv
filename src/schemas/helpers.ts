/**
 * Shared Zod helpers for schema validation
 */

import { z } from "zod";

/**
 * Zod literal that matches "" and transforms it to null.
 * Use with .or() on optional/nullable UUID fields to handle
 * EntitySelect clearing (which sends "" instead of null).
 *
 * Example: z.string().uuid().nullable().or(emptyToNull)
 */
export const emptyToNull = z.literal("").transform((): null => null);
