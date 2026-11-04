import { apiRoute } from "@/lib/api/route";
import { commandSupplierResponse } from "@/lib/api/suppliers-mutations";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const POST = apiRoute<Params>("api.v1.suppliers.restore", "suppliers:write", (request, context, { idOrCode }) =>
  commandSupplierResponse(request, context, idOrCode, "restore"), { audience: "rest" });
