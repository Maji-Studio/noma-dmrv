import { apiRoute } from "@/lib/api/route";
import { readFacilityList } from "@/lib/api/facilities-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.facilities.list", "facilities:read", async (request, { ctx, headers }) =>
  Response.json(await readFacilityList(request, ctx), { headers }));
