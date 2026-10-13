import { apiRoute } from "@/lib/api/route";
import { readFormulation } from "@/lib/api/formulations-queries";
import { formulationEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.formulations.get", "formulations:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readFormulation(request, ctx, idOrCode);
  headers.set("ETag", formulationEtag(data));
  return Response.json({ data }, { headers });
});
