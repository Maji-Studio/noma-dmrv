import { apiRoute } from "@/lib/api/route";
import { readCustomerLocationList } from "@/lib/api/customer-locations-queries";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.customers.locations.list", "customers:read", async (request, { ctx, headers }, { idOrCode }) =>
  Response.json(await readCustomerLocationList(request, ctx, idOrCode), { headers }));
