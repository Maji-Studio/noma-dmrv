import { z } from "zod";

/** Shared by full server validation and the client-safe activation accessor. */
export const emissionsEntriesEnabledSchema = z.enum(["true", "false"]).default("false").transform((value) => value === "true");
