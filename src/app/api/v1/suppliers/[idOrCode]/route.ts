import { apiRoute } from "@/lib/api/route";
import { readSupplier } from "@/lib/api/suppliers-queries";
import { supplierEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.suppliers.get", "suppliers:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readSupplier(request, ctx, idOrCode);
  headers.set("ETag", supplierEtag(data));
  return Response.json({ data }, { headers });
});
