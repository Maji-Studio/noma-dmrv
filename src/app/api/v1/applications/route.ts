import { apiRoute } from "@/lib/api/route";
import { readApplicationList } from "@/lib/api/applications-queries";

export const runtime = "nodejs";
export const maxDuration = 30;
export const GET = apiRoute("api.v1.applications.list", "applications:read", async (request, { ctx, headers }) =>
  Response.json(await readApplicationList(request, ctx), { headers }));
