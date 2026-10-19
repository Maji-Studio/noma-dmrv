import { apiRoute } from "@/lib/api/route";
import { readCustomer } from "@/lib/api/customers-queries";
import { customerEtag } from "@/lib/api/representation-etags";
import { commandCustomerResponse, updateCustomerResponse } from "@/lib/api/customers-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.customers.get", "customers:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readCustomer(request, ctx, idOrCode);
  headers.set("ETag", customerEtag(data));
  return Response.json({ data }, { headers });
});

export const PATCH = apiRoute<Params>("api.v1.customers.update", "customers:write", (request, context, { idOrCode }) =>
  updateCustomerResponse(request, context, idOrCode));

export const DELETE = apiRoute<Params>("api.v1.customers.delete", "customers:delete", (request, context, { idOrCode }) =>
  commandCustomerResponse(request, context, idOrCode, "delete"));
