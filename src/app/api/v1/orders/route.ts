import { apiRoute } from "@/lib/api/route";
import { readOrderList } from "@/lib/api/orders-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.orders.list", "orders:read", async (request, { ctx, headers }) =>
  Response.json(await readOrderList(request, ctx), { headers }));
