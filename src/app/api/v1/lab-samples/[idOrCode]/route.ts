import { apiRoute } from "@/lib/api/route";
import { readLabSample } from "@/lib/api/lab-samples-queries";
import { labSampleEtag } from "@/lib/api/representation-etags";
import { parseApiQuery } from "@/lib/api/query";
import { resourceQueries } from "@/lib/api/query-schemas";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.lab-samples.get", "lab-samples:read", async (request, { ctx, headers }, { idOrCode }) => {
  parseApiQuery(request, resourceQueries["lab-samples"].get);
  const data = await readLabSample(ctx, idOrCode);
  headers.set("ETag", labSampleEtag(data));
  return Response.json({ data }, { headers });
});
