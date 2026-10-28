import { addCustomerLocationResponse } from "@/lib/api/customer-locations-mutations";
import { apiRoute } from "@/lib/api/route";
import { readCustomerLocationList } from "@/lib/api/customer-locations-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.customers.locations.list", "customers:read", async (request, { ctx, headers }, { idOrCode }) =>
  Response.json(await readCustomerLocationList(request, ctx, idOrCode), { headers }), { audience: "rest" });

export const POST = apiRoute<Params>("api.v1.customers.locations.add", "customers:write", (request, context, { idOrCode }) =>
  addCustomerLocationResponse(request, context, idOrCode), { audience: "rest" });
