import { apiRoute } from "@/lib/api/route";
import { readOutputStockMovementList } from "@/lib/api/output-stock-movements-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.storage-locations.stock-movements.list", "biochar-products:read", async (request, { ctx, headers }, { idOrCode }) =>
  Response.json(await readOutputStockMovementList(request, ctx, idOrCode), { headers }));
