/** Real database suites: not run by the implementation agent; needs the supervisor. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { apiAuditEvents, apiRateLimitBuckets } from "@/db/schema";
import { API_RATE_LIMITS } from "@/config/api-rate-limits";
import { POST as MCP } from "@/app/api/mcp/route";
import { PATCH, DELETE } from "@/app/api/v1/feedstocks/[idOrCode]/route";
import {
  createApiFeedstockFixture, removeApiFeedstockFixture, decodedIntake, postFeedstock,
  seedApiFeedstock, committedFeedstocks, binWetStock, feedstockRequest,
  type ApiFeedstockFixture,
} from "./helpers/api-feedstock-fixture";
import { rpc, rpcBody } from "./helpers/mcp";

const switches = vi.hoisted(() => ({ writesDisabled: false }));
vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, get API_WRITES_DISABLED() { return switches.writesDisabled; } } };
});

const SUITE_TIMEOUT_MS = 30_000;
const MASS_KG = 100;
let fixture: ApiFeedstockFixture;
beforeEach(async () => { fixture = await createApiFeedstockFixture("mcp-write"); });
afterEach(async () => {
  switches.writesDisabled = false;
  vi.unstubAllEnvs();
  await db.delete(apiRateLimitBuckets).where(inArray(apiRateLimitBuckets.bucketKey,
    ["read", "write"].flatMap((access) => [
      `credential:${fixture.credentialId}:${access}`, `organization:${fixture.ctx.organizationId}:${access}`,
    ])));
  await removeApiFeedstockFixture(fixture);
});
async function call(name: string, args: Record<string, unknown>) {
  const response = await MCP(rpc(fixture.key, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}
function intake() {
  const decoded = decodedIntake(fixture, MASS_KG);
  return { ...decoded, deliveryDate: decoded.deliveryDate.toISOString().split("T")[0] };
}
const audits = () => db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, fixture.ctx.organizationId));

describe("MCP feedstock writes", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("replays a REST create without another row, stock effect or audit", async () => {
    const key = crypto.randomUUID();
    const rest = await postFeedstock(fixture, decodedIntake(fixture, MASS_KG), key);
    expect(rest.status).toBe(201);
    const result = await call("log_feedstock_delivery", { ...intake(), requestKey: key });
    expect(result.structuredContent).toEqual(await rest.json());
    expect(result.content[0].text).toMatch(/^Replayed: Logged feedstock/);
    expect(await committedFeedstocks(fixture)).toHaveLength(1);
    expect(await binWetStock(fixture)).toBe(MASS_KG);
    expect(await audits()).toMatchObject([{ transport: "rest" }]);
    const refused = await call("log_feedstock_delivery", { ...intake(), notes: "Different", requestKey: key });
    expect(refused).toMatchObject({ isError: true, structuredContent: { code: "idempotency_key_reused" } });
  });
  it.each(["update", "delete"] as const)("replays a REST %s with the original precondition", async (kind) => {
    const saved = await seedApiFeedstock(fixture, MASS_KG);
    const key = crypto.randomUUID();
    const patch = { massWetKg: MASS_KG / 2 };
    const response = await (kind === "update" ? PATCH : DELETE)(feedstockRequest(fixture,
      kind === "update" ? "PATCH" : "DELETE", `/${saved.row.id}`, kind === "update" ? patch : undefined,
      { "if-match": saved.etag, "idempotency-key": key }), { params: Promise.resolve({ idOrCode: saved.row.id }) });
    expect(response.status).toBe(kind === "update" ? 200 : 204);
    const result = await call(`${kind}_feedstock`, { feedstockId: saved.row.id, expectedVersion: saved.row.version,
      ...(kind === "update" ? patch : {}), requestKey: key });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/^Replayed:/);
    if (kind === "update") expect(result.structuredContent).toEqual(await response.json());
    else expect(result.structuredContent).toEqual({ deleted: { id: saved.row.id, code: saved.row.code } });
    expect(await binWetStock(fixture)).toBe(kind === "update" ? MASS_KG / 2 : 0);
    expect(await audits()).toHaveLength(2);
  });
  it("audits committed MCP writes once and never previews", async () => {
    const preview = await call("log_feedstock_delivery", { ...intake(), dryRun: true });
    expect(preview.isError).toBeUndefined();
    expect(preview.structuredContent.preview).toHaveLength(1);
    expect(preview.content[0].text).toContain("provisional code");
    expect(await committedFeedstocks(fixture)).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
    const created = await call("log_feedstock_delivery", { ...intake(), requestKey: crypto.randomUUID() });
    const row = created.structuredContent.data[0];
    const updated = await call("update_feedstock", { feedstockId: row.id, expectedVersion: row.version,
      notes: "Updated", requestKey: crypto.randomUUID() });
    const next = updated.structuredContent.data;
    const deleted = await call("delete_feedstock", { feedstockId: next.id, expectedVersion: next.version, requestKey: crypto.randomUUID() });
    expect(deleted.structuredContent).toEqual({ deleted: { id: next.id, code: next.code } });
    expect(await audits()).toHaveLength(3);
    expect((await audits()).every((row) => row.transport === "mcp")).toBe(true);
    expect(await binWetStock(fixture)).toBe(0);
  });
  it.each([
    { extra: {}, code: "idempotency_key_required", pointer: "/requestKey" },
    { extra: { requestKey: "bad key" }, code: "idempotency_key_invalid", pointer: "/requestKey" },
    { extra: { requestKey: "valid", mystery: true }, code: "validation_failed", pointer: "/mystery" },
  ])("rejects $code without saving", async ({ extra, code, pointer }) => {
    expect(await call("log_feedstock_delivery", { ...intake(), ...extra })).toMatchObject({
      isError: true, structuredContent: { code, issues: [{ pointer }] },
    });
    expect(await committedFeedstocks(fixture)).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });
  it("returns current on a stale update", async () => {
    const { row } = await seedApiFeedstock(fixture);
    expect(await call("update_feedstock", { feedstockId: row.id, expectedVersion: row.version + 1,
      notes: "Stale", requestKey: crypto.randomUUID() })).toMatchObject({
      isError: true, structuredContent: { code: "stale_version", current: row },
    });
  });
});


it.each([false, true])("charges write buckets for dryRun=%s while reads leave them untouched", async (dryRun) => {
  vi.stubEnv("DISABLE_RATE_LIMIT", "false");
  const bucketKeys = [
    `credential:${fixture.credentialId}:write`, `organization:${fixture.ctx.organizationId}:write`,
  ];
  const buckets = () => db.select().from(apiRateLimitBuckets)
    .where(inArray(apiRateLimitBuckets.bucketKey, bucketKeys));
  await call("whoami", {});
  expect(await buckets()).toHaveLength(0);
  await call("log_feedstock_delivery", { ...intake(), dryRun, requestKey: crypto.randomUUID() });
  const charged = await buckets();
  expect(charged).toHaveLength(2);
  for (const bucket of charged) {
    const kind = bucket.bucketKey.startsWith("credential:") ? "credential" : "organization";
    expect(bucket.tokens).toBe(API_RATE_LIMITS[kind].write - 1);
  }
  await call("whoami", {});
  expect(await buckets()).toEqual(charged);
});
it("answers the kill switch inside MCP while REST stays HTTP 503", async () => {
  switches.writesDisabled = true;
  expect(await call("log_feedstock_delivery", { ...intake(), requestKey: crypto.randomUUID() }))
    .toMatchObject({ isError: true, structuredContent: { code: "api_writes_disabled", retryable: true } });
  expect((await call("whoami", {})).isError).toBeUndefined();
  const rest = await postFeedstock(fixture);
  expect(rest.status).toBe(503);
  expect(await rest.json()).toMatchObject({ code: "api_writes_disabled", retryable: true });
  expect(await committedFeedstocks(fixture)).toHaveLength(0);
});
