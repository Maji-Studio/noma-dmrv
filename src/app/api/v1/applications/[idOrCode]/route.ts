import { apiRoute } from "@/lib/api/route";
import { readApplication } from "@/lib/api/applications-queries";
import { applicationEtag } from "@/lib/api/representation-etags";
import { mutateApplicationResponse } from "@/lib/api/applications-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;
type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.applications.get", "applications:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readApplication(request, ctx, idOrCode);
  const etag = applicationEtag(data);
  headers.set("ETag", etag);
  return Response.json({ data }, { headers });
});

export const PATCH = apiRoute<Params>("api.v1.applications.update", "applications:write", (request, context, { idOrCode }) =>
  mutateApplicationResponse(request, context, idOrCode, "PATCH"));
export const DELETE = apiRoute<Params>("api.v1.applications.delete", "applications:delete", (request, context, { idOrCode }) =>
  mutateApplicationResponse(request, context, idOrCode, "DELETE"));
