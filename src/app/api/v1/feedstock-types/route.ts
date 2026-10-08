import { apiRoute } from "@/lib/api/route";
import { readFeedstockTypeList } from "@/lib/api/feedstock-types-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.feedstock-types.list", "feedstock-types:read", async (request, { ctx, headers }) =>
  Response.json(await readFeedstockTypeList(request, ctx), { headers }));
