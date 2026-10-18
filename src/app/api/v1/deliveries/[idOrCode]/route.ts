import { apiRoute } from "@/lib/api/route";
import { readDelivery } from "@/lib/api/deliveries-queries";
import { deliveryEtag } from "@/lib/api/representation-etags";
import { updateDeliveryResponse } from "@/lib/api/deliveries-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.deliveries.get", "deliveries:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readDelivery(request, ctx, idOrCode);
  headers.set("ETag", deliveryEtag(data));
  return Response.json({ data }, { headers });
}, { audience: "rest" });

export const PATCH = apiRoute<Params>("api.v1.deliveries.update", "deliveries:write", (request, context, { idOrCode }) =>
  updateDeliveryResponse(request, context, idOrCode), { audience: "rest" });
