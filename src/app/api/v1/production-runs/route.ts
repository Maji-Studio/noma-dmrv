import { apiRoute } from "@/lib/api/route";
import { readProductionRunList } from "@/lib/api/production-runs-queries";
import { createProductionRunResponse } from "@/lib/api/production-runs-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.production-runs.list", "production-runs:read", async (request, { ctx, headers }) =>
  Response.json(await readProductionRunList(request, ctx), { headers }));
export const POST = apiRoute("api.v1.production-runs.create", "production-runs:write", createProductionRunResponse);
