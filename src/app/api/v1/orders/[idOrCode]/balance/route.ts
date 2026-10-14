import { ORDER_BALANCE_REPRESENTATION_REVISION } from "@/config/api-rest";
import { bodyHashEtag } from "@/lib/api/etag";
import { readOrderBalance } from "@/lib/api/order-balance-queries";
import { apiRoute } from "@/lib/api/route";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.orders.balance.get", "orders:read", async (request, { ctx, headers }, { idOrCode }) => {
  const body = await readOrderBalance(request, ctx, idOrCode);
  headers.set("ETag", bodyHashEtag(ORDER_BALANCE_REPRESENTATION_REVISION, body.data));
  return Response.json(body, { headers });
});

