import { apiRoute } from "@/lib/api/route";
import { readFeedstock } from "@/lib/api/feedstock-queries";
import { mutateFeedstockResponse } from "@/lib/api/feedstock-mutations";
import { feedstockEtag } from "@/lib/api/representation-etags";
import { parseApiQuery } from "@/lib/api/query";
import { resourceQueries } from "@/lib/api/query-schemas";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.feedstocks.get", "feedstocks:read", async (request, { ctx, headers }, { idOrCode }) => {
  parseApiQuery(request, resourceQueries.feedstocks.get);
  const data = await readFeedstock(ctx, idOrCode);
  headers.set("ETag", feedstockEtag(data));
  return Response.json({ data }, { headers });
});
export const PATCH = apiRoute<Params>("api.v1.feedstocks.update", "feedstocks:write", (request, context, { idOrCode }) =>
  mutateFeedstockResponse(request, context, idOrCode, "PATCH"));
export const DELETE = apiRoute<Params>("api.v1.feedstocks.delete", "feedstocks:delete", (request, context, { idOrCode }) =>
  mutateFeedstockResponse(request, context, idOrCode, "DELETE"));
