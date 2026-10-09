import { apiRoute } from "@/lib/api/route";
import { readStorageLocation } from "@/lib/api/storage-locations-queries";
import { storageLocationEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.storage-locations.get", "storage-locations:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readStorageLocation(request, ctx, idOrCode);
  headers.set("ETag", storageLocationEtag(data));
  return Response.json({ data }, { headers });
});
