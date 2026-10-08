import { apiRoute } from "@/lib/api/route";
import { readApiMe } from "@/lib/read-models/api-me";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.me", undefined, async (_request, { ctx, headers }) =>
  Response.json({ data: await readApiMe(ctx) }, { headers }));
