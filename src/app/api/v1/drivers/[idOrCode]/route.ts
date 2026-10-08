import { apiRoute } from "@/lib/api/route";
import { readDriver } from "@/lib/api/drivers-queries";
import { driverEtag } from "@/lib/api/representations/drivers";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.drivers.get", "drivers:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readDriver(request, ctx, idOrCode);
  headers.set("ETag", driverEtag(data));
  return Response.json({ data }, { headers });
});
