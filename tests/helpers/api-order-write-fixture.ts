import { randomUUID } from "node:crypto";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, orders } from "@/db/schema";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApiKey } from "@/data-access/api-keys";
import { POST } from "@/app/api/v1/orders/route";
import { GET, PATCH, DELETE } from "@/app/api/v1/orders/[idOrCode]/route";
import { createOrderDestination, orderInput } from "./order-operation-fixture";
import { createApiOrderReadFixture, readParams, readRequest } from "./api-order-read-fixture";

export async function createApiOrderWriteFixture() {
  const f = await createApiOrderReadFixture();
  const { key: deleteKey } = await createApiKey(f.ctx, { name: "Order deleter", scopes: ["orders:delete"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
  return { ...f, deleteKey, otherLocation: await createOrderDestination(f) };
}
export type ApiOrderWriteFixture = Awaited<ReturnType<typeof createApiOrderWriteFixture>>;
function request(method: string, path: string, credential: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3100/api/v1${path}`, { method, headers: {
    authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
export function postOrder(f: ApiOrderWriteFixture, body: unknown = orderInput(f), key: string | null = randomUUID(), query = "", credential = f.writeOnlyKey) {
  return POST(request("POST", `/orders${query}`, credential, body, key ? { "idempotency-key": key } : {}));
}
export function patchOrder(f: ApiOrderWriteFixture, id: string, body: unknown, etag?: string, key: string | null = randomUUID(), query = "", credential = f.writeOnlyKey) {
  return PATCH(request("PATCH", `/orders/${id}${query}`, credential, body,
    { ...(etag ? { "if-match": etag } : {}), ...(key ? { "idempotency-key": key } : {}) }), readParams(id));
}
export function deleteOrder(f: ApiOrderWriteFixture, id: string, etag?: string, key: string | null = randomUUID(), query = "", body?: unknown, credential = f.deleteKey) {
  return DELETE(request("DELETE", `/orders/${id}${query}`, credential, body,
    { ...(etag ? { "if-match": etag } : {}), ...(key ? { "idempotency-key": key } : {}) }), readParams(id));
}
export async function readRestOrder(f: ApiOrderWriteFixture, id: string) {
  const response = await GET(readRequest(`/orders/${id}`, f.orderKey), readParams(id));
  if (response.status !== 200) throw new Error(`Order read failed: ${response.status}`);
  return { row: (await response.json()).data, etag: response.headers.get("etag")! };
}
export const orderRows = (f: ApiOrderWriteFixture) => db.select().from(orders).where(eq(orders.organizationId, f.ctx.organizationId));
export const orderAudits = (f: ApiOrderWriteFixture) => db.select().from(activityEvents).where(and(inArray(activityEvents.source, ["rest", "mcp"]), isNotNull(activityEvents.operationId), eq(activityEvents.organizationId, f.ctx.organizationId)));
export const orderRecords = (f: ApiOrderWriteFixture) => db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId));
