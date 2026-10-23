import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createFacilityInTransaction } from "@/data-access/facility-mutations";
import { facilities, type Facility } from "@/db/schema";
import { createFacilitySchema } from "@/schemas/facilities";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;

/** App-only settings/sheet create; the runner owns the transaction. */
export const createFacility: Operation<typeof createFacilitySchema, Facility> = {
  id: "create_facility",
  input: createFacilitySchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, input) => withAutoCodes(
    ctx, tx, "FAC", facilities, facilities.code, AUTO_CODE_COUNT,
    ([code], savepoint) => createFacilityInTransaction(ctx, savepoint, {
      code,
      name: input.name,
      country: input.country,
      location: input.location || null,
      address: input.address || null,
      gpsLatitude: input.gpsLatitude,
      gpsLongitude: input.gpsLongitude,
      timezone: input.timezone,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
      durabilityOption: input.durabilityOption,
    }),
    CODE_CONFLICT_MESSAGES.facility,
  ),
};
