import { apiRoute } from "@/lib/api/route";
import { readStorageLocationList } from "@/lib/api/storage-locations-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.storage-locations.list", "storage-locations:read", async (request, { ctx, headers }) =>
  Response.json(await readStorageLocationList(request, ctx), { headers }));
