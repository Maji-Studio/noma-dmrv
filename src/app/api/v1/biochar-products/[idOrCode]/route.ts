import { apiRoute } from "@/lib/api/route";
import { readBiocharProduct } from "@/lib/api/biochar-products-queries";
import { updateBiocharProductResponse } from "@/lib/api/biochar-products-mutations";
import { biocharProductEtag } from "@/lib/api/representation-etags";
import { parseApiQuery } from "@/lib/api/query";
import { resourceQueries } from "@/lib/api/query-schemas";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.biochar-products.get", "biochar-products:read", async (request, { ctx, headers }, { idOrCode }) => {
  parseApiQuery(request, resourceQueries["biochar-products"].get);
  const data = await readBiocharProduct(ctx, idOrCode);
  headers.set("ETag", biocharProductEtag(data));
  return Response.json({ data }, { headers });
}, { audience: "rest" });
export const PATCH = apiRoute<Params>("api.v1.biochar-products.update", "biochar-products:write", (request, context, { idOrCode }) =>
  updateBiocharProductResponse(request, context, idOrCode), { audience: "rest" });
