import { apiRoute } from "@/lib/api/route";
import { readLabSampleList } from "@/lib/api/lab-samples-queries";
import { createLabSampleResponse } from "@/lib/api/lab-samples-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.lab-samples.list", "lab-samples:read", async (request, { ctx, headers }) =>
  Response.json(await readLabSampleList(request, ctx), { headers }), { audience: "rest" });
export const POST = apiRoute("api.v1.lab-samples.create", "lab-samples:write", createLabSampleResponse, { audience: "rest" });
