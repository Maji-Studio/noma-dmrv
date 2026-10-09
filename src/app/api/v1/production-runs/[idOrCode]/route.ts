import { apiRoute } from "@/lib/api/route";
import { readProductionRun } from "@/lib/api/production-runs-queries";
import { mutateProductionRunResponse } from "@/lib/api/production-runs-mutations";
import { productionRunEtag } from "@/lib/api/representation-etags";
import { parseApiQuery } from "@/lib/api/query";
import { resourceQueries } from "@/lib/api/query-schemas";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.production-runs.get", "production-runs:read", async (request, { ctx, headers }, { idOrCode }) => {
  parseApiQuery(request, resourceQueries["production-runs"].get);
  const data = await readProductionRun(ctx, idOrCode);
  headers.set("ETag", productionRunEtag(data));
  return Response.json({ data }, { headers });
});
export const PATCH = apiRoute<Params>("api.v1.production-runs.update", "production-runs:write", (request, context, { idOrCode }) =>
  mutateProductionRunResponse(request, context, idOrCode, "PATCH"));
export const DELETE = apiRoute<Params>("api.v1.production-runs.delete", "production-runs:delete", (request, context, { idOrCode }) =>
  mutateProductionRunResponse(request, context, idOrCode, "DELETE"));
