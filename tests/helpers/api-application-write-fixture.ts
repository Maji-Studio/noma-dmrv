import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { POST as MCP } from "@/app/api/mcp/route";
import * as collection from "@/app/api/v1/applications/route";
import * as detail from "@/app/api/v1/applications/[idOrCode]/route";
import { createApiOrderReadFixture, removeApiOrderReadFixture, readParams, readRequest } from "./api-order-read-fixture";
import { createMutationFixture, cleanupMutationFixture } from "./application-write-fixture";
import { rpc, rpcBody } from "./mcp";

export const APPLICATION_TEST_TIMEOUT_MS = 60_000;
export const APPLICATION_POLYGON = { type: "Polygon", coordinates: [[[37.42, -3.25], [37.43, -3.25], [37.43, -3.24], [37.42, -3.25]]] };
export async function createApiApplicationWriteFixture() {
  const base = await createApiOrderReadFixture();
  const tag = randomUUID();
  const chain = await createMutationFixture(tag, base.ctx.organizationId);
  const key = (await createApiKey(base.ctx, { name: "Application MCP fixture", scopes: ["applications:read", "applications:write", "applications:delete", "deliveries:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  return { ...base, chain, tag, applicationKey: key };
}
export type ApiApplicationWriteFixture = Awaited<ReturnType<typeof createApiApplicationWriteFixture>>;
export const applicationRows = (f: ApiApplicationWriteFixture) => db.select().from(applications).where(eq(applications.organizationId, f.ctx.organizationId));
export async function cleanupApiApplicationWriteFixture(f: ApiApplicationWriteFixture) {
  f.chain.applicationIds = (await applicationRows(f)).map(row => row.id);
  await cleanupMutationFixture(f.chain);
  await removeApiOrderReadFixture(f);
}
export const applicationInput = (f: ApiApplicationWriteFixture, extra: object = {}) => ({ deliveryId: f.chain.deliveryIds[0], applicationDate: "2025-07-08", appliedWetMassKg: 1200, fieldSizeHa: 3, fieldIdentifier: "North", cropType: "Maize", ...extra });
export async function applicationTool(f: ApiApplicationWriteFixture, name: string, args: object, key = f.applicationKey) {
  const response = await MCP(rpc(key, "tools/call", { name, arguments: args }));
  if (response.status !== 200) throw new Error(`MCP HTTP ${response.status}`);
  return (await rpcBody(response)).result;
}
function request(f: ApiApplicationWriteFixture, method: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3100/api/v1/applications${path}`, { method, headers: { authorization: `Bearer ${f.applicationKey}`, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
export const postApplication = (f: ApiApplicationWriteFixture, body: object, key = randomUUID(), query = "") => collection.POST(request(f, "POST", query, body, { "idempotency-key": key }));
export const patchApplication = (f: ApiApplicationWriteFixture, id: string, body: object, etag: string, key = randomUUID()) => detail.PATCH(request(f, "PATCH", `/${id}`, body, { "if-match": etag, "idempotency-key": key }), readParams(id));
export const deleteApplication = (f: ApiApplicationWriteFixture, id: string, etag: string) => detail.DELETE(request(f, "DELETE", `/${id}`, undefined, { "if-match": etag }), readParams(id));
export async function readRestApplication(f: ApiApplicationWriteFixture, id: string) {
  const response = await detail.GET(readRequest(`/applications/${id}`, f.applicationKey), readParams(id));
  return { response, body: await response.json(), etag: response.headers.get("etag")! };
}
