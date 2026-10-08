import { apiRoute } from "@/lib/api/route";
import { readVehicle } from "@/lib/api/vehicles-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.vehicles.get", "vehicles:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readVehicle(request, ctx, idOrCode);

  return Response.json({ data }, { headers });
});
