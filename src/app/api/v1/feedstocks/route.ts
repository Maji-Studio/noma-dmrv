import { apiRoute } from "@/lib/api/route";
import { readFeedstockList } from "@/lib/api/feedstock-queries";
import { createFeedstockResponse } from "@/lib/api/feedstock-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.feedstocks.list", "feedstocks:read", async (request, { ctx, headers }) =>
  Response.json(await readFeedstockList(request, ctx), { headers }));
export const POST = apiRoute("api.v1.feedstocks.create", "feedstocks:write", createFeedstockResponse);
