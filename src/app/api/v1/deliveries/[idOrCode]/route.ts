import { apiRoute } from "@/lib/api/route";
import { readDelivery } from "@/lib/api/deliveries-queries";
import { deliveryEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.deliveries.get", "deliveries:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readDelivery(request, ctx, idOrCode);
  headers.set("ETag", deliveryEtag(data));
  return Response.json({ data }, { headers });
});
