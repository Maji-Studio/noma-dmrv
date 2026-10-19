import { apiRoute } from "@/lib/api/route";
import { readReactorList } from "@/lib/api/reactors-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.reactors.list", "reactors:read", async (request, { ctx, headers }) =>
  Response.json(await readReactorList(request, ctx), { headers }));
