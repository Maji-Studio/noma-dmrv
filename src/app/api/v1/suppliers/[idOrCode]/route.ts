import { apiRoute } from "@/lib/api/route";
import { readSupplier } from "@/lib/api/suppliers-queries";
import { supplierEtag } from "@/lib/api/representation-etags";
import { commandSupplierResponse, updateSupplierResponse } from "@/lib/api/suppliers-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.suppliers.get", "suppliers:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readSupplier(request, ctx, idOrCode);
  headers.set("ETag", supplierEtag(data));
  return Response.json({ data }, { headers });
}, { audience: "rest" });

export const PATCH = apiRoute<Params>("api.v1.suppliers.update", "suppliers:write", (request, context, { idOrCode }) =>
  updateSupplierResponse(request, context, idOrCode), { audience: "rest" });

export const DELETE = apiRoute<Params>("api.v1.suppliers.delete", "suppliers:delete", (request, context, { idOrCode }) =>
  commandSupplierResponse(request, context, idOrCode, "delete"), { audience: "rest" });
