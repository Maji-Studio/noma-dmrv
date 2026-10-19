import { apiRoute } from "@/lib/api/route";
import { readFormulationList } from "@/lib/api/formulations-queries";
import { createFormulationResponse } from "@/lib/api/formulations-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.formulations.list", "formulations:read", async (request, { ctx, headers }) =>
  Response.json(await readFormulationList(request, ctx), { headers }));

export const POST = apiRoute("api.v1.formulations.create", "formulations:write", createFormulationResponse);
