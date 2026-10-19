import { apiRoute } from "@/lib/api/route";
import { readCustomerList } from "@/lib/api/customers-queries";
import { createCustomerResponse } from "@/lib/api/customers-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = apiRoute("api.v1.customers.list", "customers:read", async (request, { ctx, headers }) =>
  Response.json(await readCustomerList(request, ctx), { headers }));

export const POST = apiRoute("api.v1.customers.create", "customers:write", createCustomerResponse);
