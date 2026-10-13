/**
 * Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent.
 *
 * The same input through the Server Action and through REST stores the same
 * row and publishes the same representation. The MCP leg joins in commit 5.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleFn, deleteSampleFn, updateSampleFn } from "@/fn/samples";
import { createApiLabFixture, removeApiLabFixture, type ApiLabFixture } from "./helpers/api-lab-sample-fixture";
import {
  deleteLabSample, labSampleAudits, labSampleBody, labSampleRows, patchLabSample, postLabSample, readRestLabSample, WRITE_SAMPLED_AT,
} from "./helpers/api-lab-sample-write-fixture";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));
const TIMEOUT_MS = 90_000;
const TRANSPORTS = ["action", "rest"] as const;
type Transport = typeof TRANSPORTS[number];
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const fixtures = new Map<Transport, ApiLabFixture>();
beforeEach(async () => {
  for (const transport of TRANSPORTS) fixtures.set(transport, await createApiLabFixture());
}, TIMEOUT_MS);
afterEach(async () => {
  for (const f of fixtures.values()) await removeApiLabFixture(f);
  fixtures.clear();
  auth.requireOrgContext.mockReset();
}, TIMEOUT_MS);

/** Every lab figure the published body accepts, with ratios left for the server to calculate. */
const fullBody = (f: ApiLabFixture) => labSampleBody(f, {
  labName: "Parity Lab", labAccreditation: "ISO 17025", analysisDate: "2026-09-12", weightGrams: 50, volumeMl: 25,
  inorganicCarbonPercent: 2, totalHydrogenPercent: 2.5, totalNitrogenPercent: 0.5, totalOxygenPercent: 8, totalSulfurPercent: 0.1,
  ashContentPercent: 0, moistureContentPercent: 4, bulkDensityKgPerM3: 250, ph: 9.1, saltContentGPerKg: 1.5,
  randomReflectanceR0Percent: 2.4, sReflectanceFraction: 0.5, r0MeasurementCount: 500, r0AnalysisDate: "2026-09-13",
  reactiveCarbonPercent: 10, residualCarbonPercent: 70, tgaAnalysisDate: "2026-09-14",
  phosphorusPercent: 0.2, potassiumPercent: 0.3, magnesiumPercent: 0.4, calciumPercent: 0.5, ironPercent: 0.6,
});

/** The action's input is the same figures with a Date and the form-only fields it ignores. */
const actionBody = (f: ApiLabFixture) => ({
  ...fullBody(f), samplingTime: new Date(WRITE_SAMPLED_AT), durabilityOption: "200_year" as const, nutrientClaimEnabled: false,
});

/** Fixture ids become labels; generated ids, codes and instants are dropped. What remains is what the write stored. */
function scrub(value: unknown, f: ApiLabFixture): unknown {
  const labels: [string, string][] = [
    [f.ctx.organizationId, "org"], [f.ctx.userId, "user"], [f.facility.id, "facility"], [f.batchA.id, "batchA"], [f.batchB!.id, "batchB"],
  ];
  const dropped = new Set(["id", "createdAt", "updatedAt", "code", "sampleCode", "cursorCreatedAt"]);
  let text = JSON.stringify(value, (key, v) => dropped.has(key) ? undefined : v);
  text = text.replaceAll(f.tag, "<tag>");
  for (const [id, label] of labels) text = text.replaceAll(id, `<${label}>`);
  const unexpected = new Map<string, string>();
  return JSON.parse(text.replace(UUID_PATTERN, (id) => {
    if (!unexpected.has(id)) unexpected.set(id, `<unexpected-${unexpected.size + 1}>`);
    return unexpected.get(id)!;
  }));
}

async function create(transport: Transport, f: ApiLabFixture): Promise<string> {
  if (transport === "action") {
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const result = await createSampleFn(actionBody(f));
    if (!result.success) throw new Error(`Create refused: ${result.error}`);
    return result.data.id;
  }
  const response = await postLabSample(f, fullBody(f));
  expect(response.status).toBe(201);
  return (await response.json()).data.id;
}
async function update(transport: Transport, f: ApiLabFixture, id: string, changes: Record<string, unknown>) {
  const current = await readRestLabSample(f, id);
  if (transport === "action") {
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const result = await updateSampleFn({ sampleId: id, expectedVersion: current.row.version, ...changes });
    if (!result.success) throw new Error(`Update refused: ${result.error}`);
  } else expect((await patchLabSample(f, id, changes, current.etag)).status).toBe(200);
}

/** The stored rows and published representations of each transport, scrubbed, keyed by transport. */
async function outcomes(ids: Map<Transport, string | null>) {
  const entries = await Promise.all(TRANSPORTS.map(async (transport) => {
    const f = fixtures.get(transport)!;
    const id = ids.get(transport);
    return [transport, scrub({
      rows: await labSampleRows(f),
      representation: id ? (await readRestLabSample(f, id)).row : null,
    }, f)] as const;
  }));
  return Object.fromEntries(entries) as Record<Transport, unknown>;
}

describe("lab sample action and REST parity", { timeout: TIMEOUT_MS }, () => {
  it("stores the same row and publishes the same representation for a full create", async () => {
    const ids = new Map<Transport, string | null>();
    for (const transport of TRANSPORTS) ids.set(transport, await create(transport, fixtures.get(transport)!));
    const { action, rest } = await outcomes(ids);
    expect(rest).toEqual(action);
    expect(JSON.stringify(rest)).toContain("hToCOrgRatio");
  });

  it("stores the same row after an edit that clears a field, changes the carbon and recalculates the ratios", async () => {
    const ids = new Map<Transport, string | null>();
    for (const transport of TRANSPORTS) {
      const f = fixtures.get(transport)!;
      const id = await create(transport, f);
      ids.set(transport, id);
      await update(transport, f, id, { totalHydrogenPercent: 3, labName: null, organicCarbonPercent: 76, totalOxygenPercent: null });
    }
    const { action, rest } = await outcomes(ids);
    expect(rest).toEqual(action);
  });

  it("moves a sample to another batch the same way", async () => {
    const ids = new Map<Transport, string | null>();
    for (const transport of TRANSPORTS) {
      const f = fixtures.get(transport)!;
      const id = await create(transport, f);
      ids.set(transport, id);
      await update(transport, f, id, { creditBatchId: f.batchB!.id, samplingTime: transport === "action" ? new Date("2026-08-10T08:00:00.000Z") : "2026-08-10T08:00:00.000Z" });
    }
    const { action, rest } = await outcomes(ids);
    expect(rest).toEqual(action);
    expect(JSON.stringify(rest)).toContain("<batchB>");
  });

  it("deletes the same way and leaves one audit row only for REST", async () => {
    for (const transport of TRANSPORTS) {
      const f = fixtures.get(transport)!;
      const id = await create(transport, f);
      const current = await readRestLabSample(f, id);
      if (transport === "action") {
        auth.requireOrgContext.mockResolvedValue(f.ctx);
        expect(await deleteSampleFn({ sampleId: id, expectedVersion: current.row.version })).toMatchObject({ success: true });
      } else expect((await deleteLabSample(f, id, current.etag)).status).toBe(204);
    }
    const { action, rest } = await outcomes(new Map([["action", null], ["rest", null]]));
    expect(rest).toEqual(action);
    expect(await labSampleRows(fixtures.get("rest")!)).toEqual([]);
    expect((await labSampleAudits(fixtures.get("action")!))).toEqual([]);
    expect((await labSampleAudits(fixtures.get("rest")!)).map((row) => row.operationId).sort()).toEqual(["delete_lab_sample", "record_lab_sample"]);
  });
});
