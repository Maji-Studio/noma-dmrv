import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, formulations, formulationIngredients } from "@/db/schema";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { POST } from "@/app/api/v1/formulations/route";
import { GET, PATCH, DELETE } from "@/app/api/v1/formulations/[idOrCode]/route";
import { POST as ARCHIVE } from "@/app/api/v1/formulations/[idOrCode]/archive/route";
import { POST as RESTORE } from "@/app/api/v1/formulations/[idOrCode]/restore/route";
import type { FormulationRepresentation } from "@/lib/representations/formulations";
import { createApiOrderReadFixture, readParams, readRequest } from "./api-order-read-fixture";

export const TIMEOUT_MS = 60_000;
export const INITIAL_ETAG = '"1.2"';
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export type Command = "patch" | "delete" | "archive" | "restore";
export const commands: Command[] = ["patch", "delete", "archive", "restore"];
export async function fixture() {
  const f = await createApiOrderReadFixture();
  const key = async (scopes: ApiScope[]) => (await createApiKey(f.ctx, { name: "Formulation route fixture", scopes, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key;
  return { ...f, formulationKey: await key(["formulations:write", "formulations:read", "formulations:delete"]),
    readKey: await key(["formulations:read"]), writeKey: await key(["formulations:write"]), deleteKey: await key(["formulations:delete"]) };
}

export function formulationRouteHarness(getFixture: () => Fixture, inputOverrides: () => Record<string, unknown> = () => ({})) {
  function request(method: string, suffix: string, body?: unknown, headers: Record<string, string> = {}, credential = getFixture().formulationKey) {
    return new Request(`http://localhost:3100/api/v1/formulations${suffix}`, { method, headers: {
      authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
    }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const input = () => ({ name: "Compost blend", biocharRatio: 0.7, lines: [{ feedstockTypeId: getFixture().ingredientType.id, ratio: 0.3 }], ...inputOverrides() });
  const post = (body: unknown = input(), key: string | null = randomUUID(), query = "") => POST(request("POST", query, body, key ? { "idempotency-key": key } : {}));
  function mutate(command: Command, id: string, body?: unknown, tag: string | null = INITIAL_ETAG, key?: string, query = "", credential = getFixture().formulationKey) {
    const method = command === "patch" ? "PATCH" : command === "delete" ? "DELETE" : "POST";
    const suffix = command === "archive" || command === "restore" ? `/${command}` : "";
    const handler = { patch: PATCH, delete: DELETE, archive: ARCHIVE, restore: RESTORE }[command];
    return handler(request(method, `/${id}${suffix}${query}`, body, {
      ...(tag ? { "if-match": tag } : {}), ...(key ? { "idempotency-key": key } : {}),
    }, credential), readParams(id));
  }
  async function saved(body: unknown = input()) {
    const response = await post(body);
    expect(response.status).toBe(201);
    return (await response.json()).data as FormulationRepresentation;
  }
  async function read(id: string) {
    const response = await GET(readRequest(`/formulations/${id}`, getFixture().formulationKey), readParams(id));
    expect(response.status).toBe(200);
    return (await response.json()).data as FormulationRepresentation;
  }
  async function snapshot(f = getFixture()) {
    const organizationId = f.ctx.organizationId;
    return Promise.all([
      db.select().from(formulations).where(eq(formulations.organizationId, organizationId)).orderBy(formulations.id),
      db.select().from(formulationIngredients).where(eq(formulationIngredients.organizationId, organizationId)).orderBy(formulationIngredients.id),
      db.select().from(activityEvents).where(eq(activityEvents.organizationId, organizationId)).orderBy(activityEvents.id),
      db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, organizationId)).orderBy(apiIdempotencyRecords.id),
    ]);
  }
  return { request, input, post, mutate, saved, read, snapshot };
}

/** UUIDs and event instants are provisional on a rollback; every domain field must match. */
export function domainFields(row: FormulationRepresentation) {
  return { ...row, id: undefined, createdAt: undefined, updatedAt: undefined, archivedAt: row.archivedAt !== null,
    lines: row.lines.map(line => ({ feedstockTypeId: line.feedstockTypeId, ratio: line.ratio })) };
}

