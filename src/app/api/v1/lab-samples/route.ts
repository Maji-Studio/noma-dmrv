import { apiRoute } from "@/lib/api/route";
import { readLabSampleList } from "@/lib/api/lab-samples-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.lab-samples.list", "lab-samples:read", async (request, { ctx, headers }) =>
  Response.json(await readLabSampleList(request, ctx), { headers }));
