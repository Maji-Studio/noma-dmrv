import { apiRoute } from "@/lib/api/route";
import { readFeedstockType } from "@/lib/api/feedstock-types-queries";
import { feedstockTypeEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.feedstock-types.get", "feedstock-types:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readFeedstockType(request, ctx, idOrCode);
  headers.set("ETag", feedstockTypeEtag(data));
  return Response.json({ data }, { headers });
});
