import { apiRoute } from "@/lib/api/route";
import { readFormulation } from "@/lib/api/formulations-queries";
import { formulationEtag } from "@/lib/api/representation-etags";
import { commandFormulationResponse, updateFormulationResponse } from "@/lib/api/formulations-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.formulations.get", "formulations:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readFormulation(request, ctx, idOrCode);
  headers.set("ETag", formulationEtag(data));
  return Response.json({ data }, { headers });
});

export const PATCH = apiRoute<Params>("api.v1.formulations.update", "formulations:write", (request, context, { idOrCode }) =>
  updateFormulationResponse(request, context, idOrCode));

export const DELETE = apiRoute<Params>("api.v1.formulations.delete", "formulations:delete", (request, context, { idOrCode }) =>
  commandFormulationResponse(request, context, idOrCode, "delete"));
