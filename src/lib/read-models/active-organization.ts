import { getActiveOrganization } from "@/data-access/organizations";
import type { OrgContext } from "@/lib/auth/server";

export async function readActiveOrganization(ctx: OrgContext) {
  return getActiveOrganization(ctx);
}
