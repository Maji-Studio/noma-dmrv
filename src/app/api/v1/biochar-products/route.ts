import { apiRoute } from "@/lib/api/route";
import { readBiocharProductList } from "@/lib/api/biochar-products-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.biochar-products.list", "biochar-products:read", async (request, { ctx, headers }) =>
  Response.json(await readBiocharProductList(request, ctx), { headers }));
