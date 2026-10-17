import { apiRoute } from "@/lib/api/route";
import { readSupplierLocation } from "@/lib/api/supplier-locations-queries";
import { supplierLocationEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string; locationId: string };
export const GET = apiRoute<Params>("api.v1.suppliers.locations.get", "suppliers:read", async (request, { ctx, headers }, { idOrCode, locationId }) => {
  const data = await readSupplierLocation(request, ctx, idOrCode, locationId);
  headers.set("ETag", supplierLocationEtag(data));
  return Response.json({ data }, { headers });
});
