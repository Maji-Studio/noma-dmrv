import { findApiOrderBalance } from "@/data-access/api-order-balance";
import type { ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representOrderBalance } from "@/lib/representations/order-balance";

export async function readApiOrderBalance(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  return { data: representOrderBalance(await findApiOrderBalance(ctx, identifier)) };
}
