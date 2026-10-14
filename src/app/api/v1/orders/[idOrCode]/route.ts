import { apiRoute } from "@/lib/api/route";
import { readOrder } from "@/lib/api/orders-queries";
import { orderEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.orders.get", "orders:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readOrder(request, ctx, idOrCode);
  headers.set("ETag", orderEtag(data));
  return Response.json({ data }, { headers });
});
