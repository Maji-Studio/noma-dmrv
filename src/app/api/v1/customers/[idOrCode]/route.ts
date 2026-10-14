import { apiRoute } from "@/lib/api/route";
import { readCustomer } from "@/lib/api/customers-queries";
import { customerEtag } from "@/lib/api/representation-etags";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { idOrCode: string };
export const GET = apiRoute<Params>("api.v1.customers.get", "customers:read", async (request, { ctx, headers }, { idOrCode }) => {
  const data = await readCustomer(request, ctx, idOrCode);
  headers.set("ETag", customerEtag(data));
  return Response.json({ data }, { headers });
});
