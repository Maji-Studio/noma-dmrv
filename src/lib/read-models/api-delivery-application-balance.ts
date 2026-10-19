import { findApiDeliveryApplicationBalance } from "@/data-access/api-delivery-application-balance";
import type { ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { deliveryApplicationBalanceRepresentationSchema } from "@/lib/representations/delivery-application-balance";

export async function readApiDeliveryApplicationBalance(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  return { data: deliveryApplicationBalanceRepresentationSchema.parse(await findApiDeliveryApplicationBalance(ctx, identifier)) };
}
