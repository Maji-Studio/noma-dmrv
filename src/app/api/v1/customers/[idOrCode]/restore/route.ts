import { apiRoute } from "@/lib/api/route";
import { commandCustomerResponse } from "@/lib/api/customers-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const POST = apiRoute<Params>("api.v1.customers.restore", "customers:write", (request, context, { idOrCode }) =>
  commandCustomerResponse(request, context, idOrCode, "restore"), { audience: "rest" });
