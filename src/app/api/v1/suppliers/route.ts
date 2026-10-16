import { apiRoute } from "@/lib/api/route";
import { readSupplierList } from "@/lib/api/suppliers-queries";
import { createSupplierResponse } from "@/lib/api/suppliers-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.suppliers.list", "suppliers:read", async (request, { ctx, headers }) =>
  Response.json(await readSupplierList(request, ctx), { headers }));

export const POST = apiRoute("api.v1.suppliers.create", "suppliers:write", createSupplierResponse);
