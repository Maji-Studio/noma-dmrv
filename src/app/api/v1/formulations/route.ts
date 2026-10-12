import { apiRoute } from "@/lib/api/route";
import { readFormulationList } from "@/lib/api/formulations-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.formulations.list", "formulations:read", async (request, { ctx, headers }) =>
  Response.json(await readFormulationList(request, ctx), { headers }));
