import { apiRoute } from "@/lib/api/route";
import { readDeliveryList } from "@/lib/api/deliveries-queries";
import { createDeliveryResponse } from "@/lib/api/deliveries-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.deliveries.list", "deliveries:read", async (request, { ctx, headers }) =>
  Response.json(await readDeliveryList(request, ctx), { headers }));

export const POST = apiRoute("api.v1.deliveries.create", "deliveries:write", createDeliveryResponse);
