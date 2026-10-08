import { apiRoute } from "@/lib/api/route";
import { readSupplierList } from "@/lib/api/suppliers-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.suppliers.list", "suppliers:read", async (request, { ctx, headers }) =>
  Response.json(await readSupplierList(request, ctx), { headers }));
