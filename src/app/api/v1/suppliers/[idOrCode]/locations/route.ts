import { apiRoute } from "@/lib/api/route";
import { readSupplierLocationList } from "@/lib/api/supplier-locations-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.suppliers.locations.list", "suppliers:read", async (request, { ctx, headers }, { idOrCode }) =>
  Response.json(await readSupplierLocationList(request, ctx, idOrCode), { headers }));
