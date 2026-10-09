import { apiRoute } from "@/lib/api/route";
import { readReactor } from "@/lib/api/reactors-queries";
import { reactorEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.reactors.get", "reactors:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readReactor(request, ctx, idOrCode);
  headers.set("ETag", reactorEtag(data));
  return Response.json({ data }, { headers });
});
