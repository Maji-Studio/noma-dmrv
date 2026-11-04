import { apiRoute } from "@/lib/api/route";
import { commandFormulationResponse } from "@/lib/api/formulations-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const POST = apiRoute<Params>("api.v1.formulations.archive", "formulations:write", (request, context, { idOrCode }) =>
  commandFormulationResponse(request, context, idOrCode, "archive"), { audience: "rest" });
