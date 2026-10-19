import { apiRoute } from "@/lib/api/route";
import { readDriverList } from "@/lib/api/drivers-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.drivers.list", "drivers:read", async (request, { ctx, headers }) =>
  Response.json(await readDriverList(request, ctx), { headers }));
