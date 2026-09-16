import { z } from "zod";

/**
 * The facility identifier a client may send to a read model. It only rejects
 * malformed input: every read that accepts a facility re-checks it against the
 * active organization with `requireOrgFacility` before touching domain data.
 */
export const facilityIdSchema = z.uuid("Choose a valid facility.");

/** The same identifier where the read defaults to every facility in the org. */
export const optionalFacilityIdSchema = facilityIdSchema.optional();
