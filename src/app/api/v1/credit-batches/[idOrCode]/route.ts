import { apiRoute } from "@/lib/api/route";
import { readCreditBatch } from "@/lib/api/credit-batches-queries";
import { creditBatchEtag } from "@/lib/api/representation-etags";
import { parseApiQuery } from "@/lib/api/query";
import { resourceQueries } from "@/lib/api/query-schemas";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.credit-batches.get", "credit-batches:read", async (request, { ctx, headers }, { idOrCode }) => {
  parseApiQuery(request, resourceQueries["credit-batches"].get);
  const data = await readCreditBatch(ctx, idOrCode);
  headers.set("ETag", creditBatchEtag(data));
  return Response.json({ data }, { headers });
}, { audience: "rest" });
