import { z } from "zod";

/** A Platform Admin target, never an authority supplied by the caller. */
export const setOrganizationApiAccessSchema = z.strictObject({
  id: z.string().min(1),
  enabled: z.boolean(),
});
