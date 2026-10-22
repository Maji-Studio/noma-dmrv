import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), select: vi.fn(), batch: vi.fn(), facts: vi.fn(), contenders: vi.fn(), reservations: vi.fn(), available: vi.fn(), automatic: vi.fn(), activity: vi.fn(), context: vi.fn(), entries: vi.fn(), correctionScope: vi.fn(), carry: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction, select: mocks.select } }));
vi.mock("./emission-entries", () => ({ lockedBatch: mocks.batch, listEmissionEntriesForBatches: mocks.entries }));
vi.mock("./emission-entry-carry", () => ({ loadFacilityEmissionEntryCarry: mocks.carry }));
vi.mock("./emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: mocks.facts }));
vi.mock("./emission-entry-contenders", () => ({ listEmissionEntryAvailableApplications: mocks.available, listEmissionEntryDraftContenders: mocks.contenders, loadEmissionEntryReservations: mocks.reservations }));
vi.mock("./emission-entry-activity", () => ({ recordEmissionEntryActivity: mocks.activity }));
vi.mock("./batch-emission-automatic-figures", () => ({ loadBatchesEmissionAutomaticFacts: mocks.automatic }));
vi.mock("@/fn/certification/certify-context-core", () => ({ loadRemovalSubmissionContext: mocks.context }));
vi.mock("./certifier-removals", () => ({ getCertifierRemovalById: vi.fn(async () => ({ updatedAt: new Date("2026-01-01") })) }));
// These drafts have no returned lineage; keep correction locking at its own tested boundary.
vi.mock("./emission-entry-corrections", () => ({ lockEmissionCorrectionScope: mocks.correctionScope, emissionCorrectionWindow: () => undefined }));
import { loadRemovalEmptyLines } from "@/fn/certification/removal-empty-lines-core";
import { loadRemovalEntryContext } from "@/fn/certification/removal-entry-context";
import { resolveRemovalTemplate } from "@/fn/certification/resolve-removal-template";
import type { BatchEmissionContext } from "@/fn/certification/batch-emission-context";
import type { FacilityCertifierFacts } from "@/fn/certification/facility-certifier-facts";
import type { RemovalScope } from "@/fn/certification/removal-scope";
import { entriesWithoutRemoval } from "@/lib/certification/removal-emission-contributions";
import { isRemovalZeroEditable, recordEmissionZeros, undoEmissionZeros } from "./emission-zeros";
const ctx = makeTestOrgContext();
const removalId = "00000000-0000-4000-8000-000000000001";
const creditBatchId = "00000000-0000-4000-8000-000000000002";
const input = { removalId, creditBatchId, componentIds: ["line"], note: "  no emissions  " };
const shape = [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }];
const observation = { id: "observation", externalTemplateId: "template", definition: { groups: [{ id: "g", key: "pyrolysis", components: [
  { id: "line", displayName: "Electricity", blueprintKey: "grid_electricity_use", inputs: shape },
] }] }, enrichment: { line: { electricity_use: { unit: "kWh" } } },
lineSources: { line: { scope: "operating", origin: "reviewed", entryPolicy: "additive" } } };
let rows: unknown[][];
// The editable check of the empty-lines read: the Removal row, then its submissions.
let dbRows: unknown[][];
const insert = vi.fn();
const update = vi.fn();
const rowLock = vi.fn();
function query(result: unknown[]) {
  const q = { from: () => q, innerJoin: () => q, where: () => q, for: (mode: string) => { rowLock(mode); return q; }, orderBy: () => q, returning: () => q,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve) };
  return q;
}
beforeEach(() => {
  vi.resetAllMocks();
  rows = [[{ id: removalId, updatedAt: new Date("2026-01-01"), metadata: null }], [{ batch: { id: creditBatchId, startDate: "2026-01-01" } }], []];
  const tx = { select: () => query(rows.shift()!), insert: () => ({ values: insert }), update: () => ({ set: update }) };
  insert.mockImplementation((values) => query([{ ...values, id: "zero" }]));
  update.mockImplementation((values) => query([{ ...values, id: "zero", creditBatchId, kind: "zero", confirmedForRemovalId: removalId }]));
  dbRows = [[{ id: removalId, updatedAt: new Date("2026-01-01"), metadata: null }], []];
  mocks.select.mockImplementation(() => query(dbRows.shift()!));
  mocks.transaction.mockImplementation((fn) => fn(tx));
  mocks.batch.mockResolvedValue({ batch: { id: creditBatchId, startDate: "2026-01-01" }, observation: structuredClone(observation) });
  mocks.facts.mockResolvedValue({ entries: [] });
  mocks.contenders.mockResolvedValue([{ contenderKind: "draft", removalId, creditBatchIds: [creditBatchId], createdAt: "2026-01-01", window: { start: "2026-01-01", end: "2026-02-01" } }]);
  mocks.reservations.mockResolvedValue([]);
  mocks.available.mockResolvedValue([]);
  mocks.automatic.mockResolvedValue({ [creditBatchId]: { automaticFigures: {} } });
  mocks.carry.mockResolvedValue({ entries: [] });
});
it("records a zero with the pinned binding and trimmed note, capturing the persisted row", async () => {
  expect(await recordEmissionZeros(ctx, input)).toEqual({ entryIds: ["zero"] });
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ctx.organizationId, confirmedForRemovalId: removalId,
    observationId: "observation", occurredOn: "2026-01-01", inputShape: shape, lineRule: "additive", note: "no emissions" }));
  expect(mocks.activity).toHaveBeenCalledWith(ctx, expect.anything(), "created", null, expect.objectContaining({ id: "zero", values: [] }));
});
it("scopes the carry read to the entries on the member batches", async () => {
  mocks.facts.mockResolvedValue({ entries: [{ id: "held", componentId: "line", kind: "value", counts: true, creditBatchId, occurredOn: "2026-01-02", values: [], evidenceDocumentIds: [] }] });
  await expect(recordEmissionZeros(ctx, input)).rejects.toThrow("Only empty components");
  expect(mocks.carry).toHaveBeenCalledWith(ctx, undefined, mocks.batch.mock.calls[0][1], undefined, { entryIds: ["held"] });
});
it("refuses a nonmember batch", async () => {
  rows[1] = [];
  await expect(recordEmissionZeros(ctx, input)).rejects.toThrow("not on an editable Removal");
  expect(insert).not.toHaveBeenCalled();
});
it("refuses a submitted Removal", async () => {
  rows[2] = [{ submittedAt: new Date(), status: "submitted" }];
  await expect(recordEmissionZeros(ctx, input)).rejects.toThrow("unsubmitted");
  expect(insert).not.toHaveBeenCalled();
});
it("refuses a non-entry-capable line", async () => {
  await expect(recordEmissionZeros(ctx, { ...input, componentIds: ["missing"] })).rejects.toThrow("does not take manual entries");
  expect(insert).not.toHaveBeenCalled();
});
it("refuses a counted value that this Removal owns", async () => {
  mocks.facts.mockResolvedValue({ entries: [{ id: "value", componentId: "line", kind: "value", counts: true, creditBatchId, occurredOn: "2026-01-02", values: [], evidenceDocumentIds: [] }] });
  await expect(recordEmissionZeros(ctx, input)).rejects.toThrow("Only empty components");
  expect(insert).not.toHaveBeenCalled();
});
it("is idempotent for a duplicate zero", async () => {
  mocks.facts.mockResolvedValue({ entries: [{ id: "existing", componentId: "line", kind: "zero", confirmedForRemovalId: removalId }] });
  expect(await recordEmissionZeros(ctx, input)).toEqual({ entryIds: ["existing"] });
  expect(insert).not.toHaveBeenCalled();
  expect(mocks.activity).not.toHaveBeenCalled();
});
it("tombstones unclaimed zeros and captures their persisted before/after rows", async () => {
  rows.push([{ id: "zero", kind: "zero", creditBatchId, confirmedForRemovalId: removalId }]);
  await undoEmissionZeros(ctx, input);
  expect(mocks.activity).toHaveBeenCalledWith(ctx, expect.anything(), "deleted", expect.objectContaining({ id: "zero", values: [] }), expect.objectContaining({ id: "zero", values: [] }));
});
it("refuses undo when a zero is reserved", async () => {
  rows.push([{ id: "zero", sendReservedBySubmissionId: "attempt" }]);
  await expect(undoEmissionZeros(ctx, input)).rejects.toThrow("reserved or sent");
  expect(update).not.toHaveBeenCalled();
});
it("refuses a stale optional Removal review token", async () => {
  await expect(recordEmissionZeros(ctx, { ...input, expectedRemovalVersion: 1 })).rejects.toThrow();
  expect(insert).not.toHaveBeenCalled();
});

it.each(["sent-single", "held-single", "omitted-production", "automatic-figure", "stale-value"])("refuses %s through the server writer", async (scenario) => {
  const current = structuredClone(observation);
  if (scenario === "sent-single" || scenario === "held-single") {
    mocks.facts.mockResolvedValue({ entries: [{ id: "sent", componentId: "line", kind: "value", lineRule: "single", counts: true,
      creditBatchId, occurredOn: "2026-01-02", sentByRemovalId: scenario === "sent-single" ? "earlier" : null,
      heldForRemovalId: scenario === "held-single" ? "earlier" : null, values: [], evidenceDocumentIds: ["file"] }] });
  } else if (scenario === "stale-value") {
    mocks.facts.mockResolvedValue({ entries: [{ id: "stale", componentId: "line", kind: "value", counts: false,
      creditBatchId, occurredOn: "2026-01-02", values: [], evidenceDocumentIds: [] }] });
  } else {
    Object.assign(current.lineSources.line, { automaticSource: "run-electricity" });
    mocks.automatic.mockResolvedValue({ [creditBatchId]: { automaticFigures: { "run-electricity": { magnitude: "10", unit: "kWh" } } } });
  }
  mocks.batch.mockResolvedValue({ batch: { id: creditBatchId, startDate: "2026-01-01",
    productionEmissionsClaimedByRemovalId: scenario === "omitted-production" ? "earlier" : null }, observation: current });
  rows[1] = [{ batch: { id: creditBatchId, startDate: "2026-01-01", productionEmissionsClaimedByRemovalId: scenario === "omitted-production" ? "earlier" : null } }];
  await expect(recordEmissionZeros(ctx, input)).rejects.toThrow("Only empty components");
  expect(insert).not.toHaveBeenCalled();
});
it("locks the Removal before its batch", async () => {
  await recordEmissionZeros(ctx, input);
  expect(mocks.batch).toHaveBeenCalledOnce();
  expect(mocks.correctionScope).toHaveBeenCalledWith(ctx, mocks.batch.mock.calls[0][1], creditBatchId);
  expect(mocks.correctionScope.mock.invocationCallOrder[0]).toBeLessThan(mocks.batch.mock.invocationCallOrder[0]);
  // The Removal read has already consumed the first result when the batch lock is requested.
  mocks.batch.mockImplementationOnce(async () => {
    expect(rows).toHaveLength(2);
    return { batch: { id: creditBatchId, startDate: "2026-01-01" }, observation };
  });
  rows = [[{ id: removalId, updatedAt: new Date(), metadata: null }], [{ batch: { id: creditBatchId, startDate: "2026-01-01" } }], []];
  await recordEmissionZeros(ctx, input);
});

it("accepts the same empty line as the read when a value awaits a future application", async () => {
  mocks.facts.mockResolvedValue({ entries: [{ id: "later", componentId: "line", kind: "value", counts: true,
    creditBatchId, occurredOn: "2026-03-01", values: [], evidenceDocumentIds: [] }] });
  mocks.available.mockResolvedValue([{ creditBatchId, applicationDate: new Date("2026-04-01") }]);
  expect(await recordEmissionZeros(ctx, input)).toEqual({ entryIds: ["zero"] });
  const tx = mocks.batch.mock.calls[0][1];
  expect(mocks.automatic).toHaveBeenCalledWith(ctx, [creditBatchId], {}, tx);
  expect(mocks.available).toHaveBeenCalledWith(ctx, [creditBatchId], tx);
});
it("refuses undo with a stale Removal review token", async () => {
  await expect(undoEmissionZeros(ctx, { removalId, creditBatchId, expectedRemovalVersion: 1 })).rejects.toMatchObject({ code: "stale_version" });
  expect(update).not.toHaveBeenCalled();
});

it.each(["empty", "future-application", "orphan", "sent-single", "automatic", "omitted-production", "stale", "other-batch-single"])(
  "read and transactional writer agree on empty components: %s", async (scenario) => {
    const current = structuredClone(observation);
    const otherBatchId = "00000000-0000-4000-8000-000000000003";
    const members = [creditBatchId, otherBatchId].map((id) => ({ id, startDate: "2026-01-01", removalTemplateId: "template",
      productionEmissionsClaimedByRemovalId: scenario === "omitted-production" ? "earlier" : null }));
    const entries: BatchEmissionContext[string]["entries"] = [];
    if (["automatic", "omitted-production"].includes(scenario)) Object.assign(current.lineSources.line, { automaticSource: "run-electricity" });
    if (["future-application", "orphan", "sent-single", "stale", "other-batch-single"].includes(scenario)) {
      entries.push({ id: "value", creditBatchId: scenario === "other-batch-single" ? otherBatchId : creditBatchId,
        componentId: "line", observationId: "observation", kind: "value", contentRevision: 1,
        lineRule: ["sent-single", "other-batch-single"].includes(scenario) ? "single" : "additive",
        occurredOn: ["future-application", "orphan"].includes(scenario) ? "2026-03-01" : "2026-01-02",
        counts: scenario !== "stale", hasEvidence: true, evidenceDocumentIds: ["file"],
        sentByRemovalId: scenario === "sent-single" ? "earlier" : null,
        sendReservedBySubmissionId: null, confirmedForRemovalId: null, deletedAt: null,
        total: { magnitude: "1", unit: "kWh" }, values: [{ inputKey: "electricity_use", magnitude: "1", unit: "kWh" }],
      } as BatchEmissionContext[string]["entries"][number]);
    }
    const contenders = [{ contenderKind: "draft" as const, removalId, creditBatchIds: members.map((batch) => batch.id),
      createdAt: "2026-01-01", window: { start: "2026-01-01", end: "2026-02-01" } }];
    const available = scenario === "future-application" ? [{ creditBatchId, applicationDate: new Date("2026-04-01") }] : [];
    const orphanIds = entriesWithoutRemoval(entries, contenders, new Set(), available);
    const automaticFigures = ["automatic", "omitted-production"].includes(scenario)
      ? { "run-electricity": { magnitude: "10", unit: "kWh" } } : {};
    const facts: BatchEmissionContext = Object.fromEntries(members.map((batch) => [batch.id, {
      entries: entries.filter((entry) => entry.creditBatchId === batch.id), previousObservations: new Map(),
      contenders, entriesWithoutRemoval: orphanIds, automaticFigures,
    }]));
    const template = { id: "template", groups: [{ id: "g", key: "pyrolysis", components: [{ id: "line", display_name: "Electricity",
      blueprint_key: "grid_electricity_use", inputs: [{ input_key: "electricity_use", type: "monitored", quantity_kind: "energy" }] }] }] };
    const facility = { facilityTimezone: "UTC", templatesById: { template: { template, observation: current, enrichmentProblems: [], lineSourceProblems: [],
      blueprintsForTemplate: [], unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], requiredTransportCategories: [],
    } } } as unknown as FacilityCertifierFacts;
    const scope = { removalId, memberBatches: members, lineages: [{ application: { applicationDate: new Date("2026-02-01") } }] } as RemovalScope;
    const loaded = await loadRemovalEntryContext(ctx, scope, facts, facility);
    const resolved = resolveRemovalTemplate(members, facility, loaded!.batchFacts, loaded!.contributions);
    mocks.context.mockResolvedValue({ ...resolved, memberBatches: members });
    mocks.entries.mockResolvedValue(entries);
    const read = await loadRemovalEmptyLines(ctx, removalId);
    expect(read.editable).toBe(true);
    const emptyIds = read.batches.find((batch) => batch.creditBatchId === creditBatchId)!.lines.map((line) => line.componentId);
    expect(emptyIds).toEqual(["empty", "future-application", "other-batch-single"].includes(scenario) ? ["line"] : []);

    rows[1] = members.map((batch) => ({ batch }));
    mocks.batch.mockResolvedValue({ batch: members[0], observation: current });
    mocks.facts.mockImplementation(async (_ctx, id) => facts[id]);
    mocks.contenders.mockResolvedValue(contenders);
    mocks.available.mockResolvedValue(available);
    mocks.automatic.mockResolvedValue(Object.fromEntries(members.map((batch) => [batch.id, { automaticFigures }])));
    if (emptyIds.includes("line")) await expect(recordEmissionZeros(ctx, input)).resolves.toEqual({ entryIds: ["zero"] });
    else await expect(recordEmissionZeros(ctx, input)).rejects.toThrow("Only empty components");
    const tx = mocks.batch.mock.calls[0][1];
    expect(mocks.facts).toHaveBeenCalledWith(ctx, otherBatchId, current, tx);
    expect(mocks.contenders).toHaveBeenCalledWith(ctx, members.map((batch) => batch.id), tx);
    expect(mocks.reservations).toHaveBeenLastCalledWith(ctx, [], tx);
  },
);

it.each(["record", "undo"])("uses a Removal lock compatible with stamping for %s", async (action) => {
  if (action === "record") await recordEmissionZeros(ctx, input);
  else { rows.push([]); await undoEmissionZeros(ctx, input); }
  expect(rowLock).toHaveBeenNthCalledWith(1, "no key update");
});

it.each([["correction", true], ["draft", false]] as const)("a submitted Removal is zero-editable only in its correction window (%s)", async (contenderKind, editable) => {
  dbRows = [[{ id: removalId, updatedAt: new Date("2026-01-01"), metadata: null }], [{ status: "submitted", submittedAt: new Date("2026-01-02") }], [{ id: creditBatchId }]];
  mocks.contenders.mockResolvedValue([{ contenderKind, removalId, creditBatchIds: [creditBatchId], createdAt: "2026-01-01", window: { start: "2026-01-01", end: "2026-02-01" } }]);
  expect(await isRemovalZeroEditable(ctx, removalId)).toBe(editable);
  expect(mocks.contenders).toHaveBeenCalledWith(ctx, [creditBatchId]);
});
