import { apiRoute } from "@/lib/api/route";
import { readFacility } from "@/lib/api/facilities-queries";
import { facilityEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.facilities.get", "facilities:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readFacility(request, ctx, idOrCode);
  headers.set("ETag", facilityEtag(data));
  return Response.json({ data }, { headers });
});
