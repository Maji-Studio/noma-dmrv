import { mutateCustomerLocationResponse } from "@/lib/api/customer-locations-mutations";
import { apiRoute } from "@/lib/api/route";
import { readCustomerLocation } from "@/lib/api/customer-locations-queries";
import { customerLocationEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string; locationId: string };
export const GET = apiRoute<Params>("api.v1.customers.locations.get", "customers:read", async (request, { ctx, headers }, { idOrCode, locationId }) => {
  const data = await readCustomerLocation(request, ctx, idOrCode, locationId);
  headers.set("ETag", customerLocationEtag(data));
  return Response.json({ data }, { headers });
}, { audience: "rest" });

export const PATCH = apiRoute<Params>("api.v1.customers.locations.patch", "customers:write", (request, context, { idOrCode, locationId }) =>
  mutateCustomerLocationResponse(request, context, idOrCode, locationId, "patch"), { audience: "rest" });

export const DELETE = apiRoute<Params>("api.v1.customers.locations.delete", "customers:delete", (request, context, { idOrCode, locationId }) =>
  mutateCustomerLocationResponse(request, context, idOrCode, locationId, "delete"), { audience: "rest" });
