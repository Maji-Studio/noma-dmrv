import { DELIVERY_APPLICATION_BALANCE_REPRESENTATION_REVISION } from "@/config/api-rest";
import { bodyHashEtag } from "@/lib/api/etag";
import { readDeliveryApplicationBalance } from "@/lib/api/delivery-application-balance-queries";
import { apiRoute } from "@/lib/api/route";

export const runtime = "nodejs";
export const maxDuration = 30;
type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.deliveries.application-balance.get", "deliveries:read", async (request, { ctx, headers }, { idOrCode }) => {
  const body = await readDeliveryApplicationBalance(request, ctx, idOrCode);
  headers.set("ETag", bodyHashEtag(DELIVERY_APPLICATION_BALANCE_REPRESENTATION_REVISION, body.data));
  return Response.json(body, { headers });
}, { audience: "rest" });
