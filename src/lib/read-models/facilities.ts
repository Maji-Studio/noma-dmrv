import {
  getFacilities,
  type PaginatedFacilities,
} from "@/data-access/facilities";
import type { OrgContext } from "@/lib/auth/server";
import { facilityFilterSchema } from "@/schemas/facilities";

/** One page of the organization's facilities, for both read transports. */
export async function readFacilities(
  ctx: OrgContext,
  input?: unknown,
): Promise<PaginatedFacilities> {
  return getFacilities(ctx, facilityFilterSchema.parse(input ?? {}));
}
