import { apiRoute } from "@/lib/api/route";
import { readVehicleList } from "@/lib/api/vehicles-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.vehicles.list", "vehicles:read", async (request, { ctx, headers }) =>
  Response.json(await readVehicleList(request, ctx), { headers }));
