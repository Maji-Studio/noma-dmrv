import { apiRoute } from "@/lib/api/route";
import { readCreditBatchList } from "@/lib/api/credit-batches-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.credit-batches.list", "credit-batches:read", async (request, { ctx, headers }) =>
  Response.json(await readCreditBatchList(request, ctx), { headers }), { audience: "rest" });
