import { apiRoute } from "@/lib/api/route";
import { readApplicationBoundary } from "@/lib/api/applications-queries";
import { applicationEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;
type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.applications.boundary.get", "applications:read", async (request, { ctx, headers }, { idOrCode }) => {
  const { data, version } = await readApplicationBoundary(request, ctx, idOrCode);
  const etag = applicationEtag({ version });
  headers.set("ETag", etag);
  return Response.json({ data }, { headers });
});
