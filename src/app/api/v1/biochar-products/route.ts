import { apiRoute } from "@/lib/api/route";
import { readBiocharProductList } from "@/lib/api/biochar-products-queries";
import { createBiocharProductResponse } from "@/lib/api/biochar-products-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.biochar-products.list", "biochar-products:read", async (request, { ctx, headers }) =>
  Response.json(await readBiocharProductList(request, ctx), { headers }), { audience: "rest" });
export const POST = apiRoute("api.v1.biochar-products.create", "biochar-products:write", createBiocharProductResponse, { audience: "rest" });
