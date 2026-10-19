import { OUTPUT_BIN_STOCK_REPRESENTATION_REVISION } from "@/config/api-rest";
import { bodyHashEtag } from "@/lib/api/etag";
import { readOutputBinStock } from "@/lib/api/output-bin-stock-queries";
import { apiRoute } from "@/lib/api/route";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.storage-locations.stock.get", "biochar-products:read", async (request, { ctx, headers }, { idOrCode }) => {
  const body = await readOutputBinStock(request, ctx, idOrCode);
  headers.set("ETag", bodyHashEtag(OUTPUT_BIN_STOCK_REPRESENTATION_REVISION, body.data));
  return Response.json(body, { headers });
});

