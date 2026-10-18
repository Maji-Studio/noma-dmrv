import { apiRoute } from "@/lib/api/route";
import { readLabSample } from "@/lib/api/lab-samples-queries";
import { mutateLabSampleResponse } from "@/lib/api/lab-samples-mutations";
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
}, { audience: "rest" });
export const PATCH = apiRoute<Params>("api.v1.lab-samples.update", "lab-samples:write", (request, context, { idOrCode }) =>
  mutateLabSampleResponse(request, context, idOrCode, "PATCH"), { audience: "rest" });
export const DELETE = apiRoute<Params>("api.v1.lab-samples.delete", "lab-samples:delete", (request, context, { idOrCode }) =>
  mutateLabSampleResponse(request, context, idOrCode, "DELETE"), { audience: "rest" });
