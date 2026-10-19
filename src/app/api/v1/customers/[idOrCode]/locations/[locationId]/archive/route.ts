import { apiRoute } from "@/lib/api/route";
import { mutateCustomerLocationResponse } from "@/lib/api/customer-locations-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string; locationId: string };
export const POST = apiRoute<Params>("api.v1.customers.locations.archive", "customers:write", (request, context, { idOrCode, locationId }) =>
  mutateCustomerLocationResponse(request, context, idOrCode, locationId, "archive"));
