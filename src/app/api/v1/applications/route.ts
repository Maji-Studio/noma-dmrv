import { apiRoute } from "@/lib/api/route";
import { readApplicationList } from "@/lib/api/applications-queries";
import { createApplicationResponse } from "@/lib/api/applications-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;
export const GET = apiRoute("api.v1.applications.list", "applications:read", async (request, { ctx, headers }) =>
  Response.json(await readApplicationList(request, ctx), { headers }), { audience: "rest" });

export const POST = apiRoute("api.v1.applications.create", "applications:write", createApplicationResponse, { audience: "rest" });
