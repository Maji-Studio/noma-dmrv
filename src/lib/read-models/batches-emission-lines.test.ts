import { listEmissionEntryDraftContenders } from "@/data-access/emission-entry-contenders";
vi.mock("@/data-access/emission-entry-contenders", () => ({ listEmissionEntryDraftContenders: vi.fn() }));
import { loadComponentFileReservations } from "@/data-access/component-file-reservations";
vi.mock("@/data-access/component-file-reservations", () => ({ loadComponentFileReservations: vi.fn() }));
import { listEmissionLineFilesForBatches } from "@/data-access/emission-line-files";
import { loadBatchEmissionEntryCarry } from "@/data-access/emission-entry-carry";
vi.mock("@/data-access/emission-entry-carry", () => ({ loadBatchEmissionEntryCarry: vi.fn() }));
import { listDocumentUploadsForDocuments } from "@/data-access/certifier-document-uploads";
vi.mock("@/data-access/certifier-document-uploads", () => ({ listDocumentUploadsForDocuments: vi.fn() }));
import { assert, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";

vi.mock("@/data-access/emission-entries", () => ({ listEmissionEntriesForBatches: vi.fn() }));
vi.mock("@/data-access/emission-line-comments", () => ({ listEmissionLineCommentsForBatches: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ getLatestTemplateObservations: vi.fn(), getTemplateObservationsByIds: vi.fn() }));
vi.mock("@/data-access/batch-emission-automatic-figures", () => ({ loadBatchesEmissionAutomaticFacts: vi.fn() }));
import { listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { listEmissionLineCommentsForBatches } from "@/data-access/emission-line-comments";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "@/data-access/removal-template-observations";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { buildBatchEmissionLines, loadBatchesEmissionLines } from "./batches-emission-lines";

const ctx = makeTestOrgContext();
const observation: EntryObservation & { id: string } = {
  id: "observation", externalTemplateId: "template",
  definition: { groups: [{ id: "group", key: "pyrolysis", displayName: "Pyrolysis", description: "", components: [{
    id: "electricity", displayName: "Electricity", description: null, blueprintKey: "grid_electricity_use",
    inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }],
  }] }] },
  enrichment: { electricity: { electricity_use: { unit: "kWh" } } },
  lineSources: { electricity: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
};
const batches = [
  { id: "ready", removalTemplateId: "template" },
  { id: "unread", removalTemplateId: "unread-template" },
  { id: "unpinned", removalTemplateId: null },
];
const stored = { id: "stored", creditBatchId: "unread", observationId: "previous" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadComponentFileReservations).mockResolvedValue([]);
  vi.mocked(listEmissionEntryDraftContenders).mockResolvedValue([]);
  vi.mocked(listEmissionLineFilesForBatches).mockResolvedValue([]);
  vi.mocked(listDocumentUploadsForDocuments).mockResolvedValue([]);
  vi.mocked(loadBatchEmissionEntryCarry).mockResolvedValue([]);
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([observation] as never);
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([]);
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([stored] as never);
  vi.mocked(loadBatchesEmissionAutomaticFacts).mockResolvedValue({ ready: { automaticFigures: {} }, sibling: { automaticFigures: {} } });
  vi.mocked(listEmissionLineCommentsForBatches).mockResolvedValue([]);
});

it("returns the union per batch and retains stored entries on blocked batches", async () => {
  const results = await loadBatchesEmissionLines(ctx, batches);
  const ready = results.get("ready")!;
  assert(ready.status === "ready");
  expect(ready.storedEntries).toEqual([]);
  expect(ready.lines.map(line => line.componentId)).toEqual(["electricity"]);
  expect(results.get("unread")).toEqual({ status: "blocked", blocker: "templateNotFullyRead", storedEntries: [stored] });
  expect(results.get("unpinned")).toEqual({ status: "blocked", blocker: "unpinnedTemplate", storedEntries: [] });
  expect(getLatestTemplateObservations).toHaveBeenCalledExactlyOnceWith(ctx, "isometric", ["template", "unread-template"]);
  expect(listEmissionEntriesForBatches).toHaveBeenCalledExactlyOnceWith(ctx, ["ready", "unread", "unpinned"]);
  expect(getTemplateObservationsByIds).toHaveBeenCalledExactlyOnceWith(ctx, []);
  expect(loadBatchesEmissionAutomaticFacts).toHaveBeenCalledExactlyOnceWith(ctx, ["ready"]);
  expect(listEmissionLineCommentsForBatches).not.toHaveBeenCalled();
});

it("loads previous observations only for entries belonging to ready batches", async () => {
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([
    stored, { id: "ready-entry", creditBatchId: "ready", observationId: "ready-previous", componentId: "electricity", values: [] },
    { id: "current-entry", creditBatchId: "ready", observationId: observation.id, componentId: "electricity", values: [] },
  ] as never);
  await loadBatchesEmissionLines(ctx, batches, { comments: true });
  expect(getTemplateObservationsByIds).toHaveBeenCalledExactlyOnceWith(ctx, ["ready-previous"]);
  expect(listEmissionLineCommentsForBatches).toHaveBeenCalledExactlyOnceWith(ctx, ["ready"]);
});

it("skips comments and requests no previous observations or automatic facts when every batch is blocked", async () => {
  const results = await loadBatchesEmissionLines(ctx, batches.slice(1), { comments: true });
  expect(results.get("unread")).toEqual({ status: "blocked", blocker: "templateNotFullyRead", storedEntries: [stored] });
  expect(results.get("unpinned")).toEqual({ status: "blocked", blocker: "unpinnedTemplate", storedEntries: [] });
  expect(getTemplateObservationsByIds).toHaveBeenCalledExactlyOnceWith(ctx, []);
  expect(loadBatchesEmissionAutomaticFacts).toHaveBeenCalledExactlyOnceWith(ctx, []);
  expect(listEmissionLineCommentsForBatches).not.toHaveBeenCalled();
});

it("keeps incomplete observations ready with templateNotFullyRead on their lines", async () => {
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([{
    ...observation, enrichment: { electricity: { electricity_use: { status: "unknown" } } },
  }] as never);
  const result = (await loadBatchesEmissionLines(ctx, batches)).get("ready")!;
  assert(result.status === "ready");
  expect(result.lines).toHaveLength(1);
  expect(result.lines[0]).toMatchObject({ componentId: "electricity", state: "needsReview", blocker: { code: "templateNotFullyRead" } });
});

it("loads comments once in bulk only when requested and isolates them by batch", async () => {
  const inputs = [batches[0], { id: "sibling", removalTemplateId: "template" }];
  const comment = { id: "comment", creditBatchId: "ready", componentId: "electricity", body: "Context", version: 1,
    updatedAt: new Date("2026-10-15T00:00:00Z"), updatedBy: "user-id" };
  vi.mocked(listEmissionLineCommentsForBatches).mockResolvedValue([comment] as never);
  const without = await loadBatchesEmissionLines(ctx, inputs);
  expect(listEmissionLineCommentsForBatches).not.toHaveBeenCalled();
  const withComments = await loadBatchesEmissionLines(ctx, inputs, { comments: true });
  expect(listEmissionLineCommentsForBatches).toHaveBeenCalledExactlyOnceWith(ctx, ["ready", "sibling"]);
  for (const batch of inputs) {
    const plain = without.get(batch.id)!;
    const result = withComments.get(batch.id)!;
    assert(plain.status === "ready" && result.status === "ready");
    expect(result.lines.map(line => ({ ...line, comment: null }))).toEqual(plain.lines);
    expect(result.lines[0].comment).toEqual(batch.id === "ready" ? {
      id: comment.id, body: comment.body, version: comment.version, updatedAt: comment.updatedAt, updatedBy: comment.updatedBy,
    } : null);
  }
});

it("derives different template pins independently", async () => {
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([
    observation, { ...observation, id: "other-observation", externalTemplateId: "other-template", definition: { groups: [] } },
  ] as never);
  const results = await loadBatchesEmissionLines(ctx, [batches[0], { id: "sibling", removalTemplateId: "other-template" }]);
  expect(results.get("ready")).toMatchObject({ status: "ready", lines: [expect.objectContaining({ componentId: "electricity" })] });
  expect(results.get("sibling")).toEqual({ status: "ready", lines: [], storedEntries: [] });
});

it("avoids all reads for an empty set", async () => {
  expect(await loadBatchesEmissionLines(ctx, [], { comments: true })).toEqual(new Map());
  expect(getLatestTemplateObservations).not.toHaveBeenCalled();
  expect(listEmissionEntriesForBatches).not.toHaveBeenCalled();
  expect(listEmissionLineCommentsForBatches).not.toHaveBeenCalled();
  expect(loadBatchesEmissionAutomaticFacts).not.toHaveBeenCalled();
});

it("exposes carry destinations, revisions, waiting reasons and actual senders on the existing batch lines", async () => {
  const destination = { removalId: "receiver", removalCode: "RM-010", creditBatchCodes: ["CB-010"], creditBatchIds: ["cb-010"], anotherCreditBatch: true };
  const carry = { receiver: destination, waitingReason: null };
  const entry = { id: "carry-entry", creditBatchId: "ready", observationId: observation.id, componentId: "electricity", kind: "value",
    values: [{ inputKey: "electricity_use", magnitude: "120", unit: "kWh" }], documentCount: 1 };
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([entry] as never);
  for (const state of [{ carry, reportedIn: null }, { carry: { receiver: null, waitingReason: "noDraft" }, reportedIn: null },
    { carry: { receiver: null, waitingReason: null }, reportedIn: destination },
    { carry: { receiver: null, waitingReason: null }, reportedIn: null, revisionOf: { removalId: "own", removalCode: "RM-009" } }]) {
    vi.mocked(loadBatchEmissionEntryCarry).mockResolvedValue([{ ...entry, ...state }] as never);
    const result = (await loadBatchesEmissionLines(ctx, [batches[0]])).get("ready")!;
    assert(result.status === "ready");
    expect(result.lines[0].entries[0]).toMatchObject(state);
  }
});

describe("time-based lines", () => {
  const timeObservation = (rate: { unit: string; fixedValue?: string | number | null } | { status: "unknown" } | undefined): EntryObservation => ({
    externalTemplateId: "template",
    definition: { groups: [{ id: "group", key: "direct", displayName: "Direct", description: "", components: [{
      id: "time", displayName: "Pyrolyzer CH4 time emissions", description: null, blueprintKey: "time_based_emissions",
      inputs: [
        { key: "emissions_per_unit_time", type: "fixed", quantityKind: "time_emission_factor", fixedDatapointId: "dtp" },
        { key: "time", type: "monitored", quantityKind: "time" },
      ],
    }] }] },
    enrichment: { time: { ...(rate ? { emissions_per_unit_time: rate } : {}), time: { unit: "hour" } } },
    lineSources: { time: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
  });
  const lineOf = (observation: EntryObservation) =>
    buildBatchEmissionLines(observation, [], new Map(), { automaticFigures: {}, automaticRecordCounts: {}, feedstockTransportCountedOn: [] })[0];

  it("carries the fixed rate in kgCO2e per hour", () => {
    expect(lineOf(timeObservation({ unit: "kgCO2e / hour", fixedValue: "0.41264" })).timeEmission).toEqual({ ratePerHour: 0.41264 });
    expect(lineOf(timeObservation({ unit: "kgCO2e / day", fixedValue: 24 })).timeEmission).toEqual({ ratePerHour: 1 });
  });

  it("flags the line as time-based with no rate when it is missing or its unit unknown", () => {
    expect(lineOf(timeObservation(undefined)).timeEmission).toEqual({ ratePerHour: null });
    expect(lineOf(timeObservation({ status: "unknown" })).timeEmission).toEqual({ ratePerHour: null });
    expect(lineOf(timeObservation({ unit: "kgCO2e / furlong", fixedValue: 1 })).timeEmission).toEqual({ ratePerHour: null });
  });

  it("leaves other lines unflagged", () => {
    expect(lineOf(observation).timeEmission).toBeNull();
  });
});

vi.mock("@/data-access/emission-line-files", () => ({ listEmissionLineFilesForBatches: vi.fn() }));

it.each(["claimed", "reserved"])("keeps locked %s records visible without a file blocker", async kind => {
  const proofObservation = structuredClone(observation);
  proofObservation.lineSources.electricity = { ...proofObservation.lineSources.electricity,
    automaticSource: "run-electricity", filePolicy: "lineFile" };
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([proofObservation] as never);
  vi.mocked(loadBatchesEmissionAutomaticFacts).mockResolvedValue({ ready: { automaticFigures: {
    "run-electricity": { magnitude: "5", unit: "kWh" },
  } } });
  const result = (await loadBatchesEmissionLines(ctx, [{ ...batches[0],
    productionEmissionsClaimedByRemovalId: kind === "claimed" ? "sent" : null,
    productionEmissionsClaimReservedBySubmissionId: kind === "reserved" ? "submission" : null,
  }])).get("ready")!;
  assert(result.status === "ready");
  expect(result.lines[0].blocker).toBeUndefined();
  expect(result.lines[0]).toMatchObject({ records: { figure: { magnitude: "5", unit: "kWh" } },
    lineFile: { documents: [], needsFile: false, locked: true, canReplace: false } });
});

it("groups all uploaded documents under their one anchor in the read model", async () => {
  const proofObservation = structuredClone(observation);
  proofObservation.lineSources.electricity = { ...proofObservation.lineSources.electricity,
    automaticSource: "run-electricity", filePolicy: "lineFile" };
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([proofObservation] as never);
  vi.mocked(loadBatchesEmissionAutomaticFacts).mockResolvedValue({ ready: { automaticFigures: {
    "run-electricity": { magnitude: "5", unit: "kWh" },
  } } });
  const documents = ["first", "second"].map(id => ({ id, fileName: id + ".pdf", version: 1 }));
  vi.mocked(listEmissionLineFilesForBatches).mockResolvedValue(documents.map(document => ({
    anchor: { id: "anchor", componentId: "electricity", creditBatchId: "ready", version: 3 }, document,
  })) as never);
  const result = (await loadBatchesEmissionLines(ctx, [batches[0]])).get("ready")!;
  assert(result.status === "ready");
  expect(result.lines[0].lineFile).toEqual({ anchorId: "anchor", version: 3, documents: documents.map(document => ({ ...document, sent: false })), locked: false, canReplace: false, needsFile: true, policy: "lineFile" });
  expect(result.lines[0].blocker).toBeUndefined();
});

it.each(["stale", "rejected", "correction", "closed", "other-removal", "other-batch", "reserved-correction"])("uses the component-file lock rule for %s", async state => {
  const reserved = ["stale", "rejected", "reserved-correction"].includes(state);
  const claimed = !["stale", "rejected"].includes(state);
  const locked = ["closed", "other-removal", "other-batch", "reserved-correction"].includes(state);
  vi.mocked(loadComponentFileReservations).mockResolvedValue(reserved ? [{
    id: "submission", provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: "sent",
    status: state === "rejected" ? "rejected" : "draft", lockedAt: state === "reserved-correction" ? new Date() : new Date(0), metadata: {},
  }] as never : []);
  vi.mocked(listEmissionEntryDraftContenders).mockResolvedValue(state === "closed" ? [] : [{
    contenderKind: "correction", removalId: state === "other-removal" ? "another" : "sent", createdAt: "2026-01-01",
    creditBatchIds: [state === "other-batch" ? "another-batch" : "ready"], window: { start: "2026-01-01", end: "2026-02-01" },
  }]);
  const proof = structuredClone(observation);
  Object.assign(proof.lineSources.electricity, { automaticSource: "run-electricity", filePolicy: "lineFile" });
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([proof] as never);
  vi.mocked(loadBatchesEmissionAutomaticFacts).mockResolvedValue({ ready: { automaticFigures: { "run-electricity": { magnitude: "5", unit: "kWh" } } } });
  const result = (await loadBatchesEmissionLines(ctx, [{ ...batches[0],
    productionEmissionsClaimedByRemovalId: claimed ? "sent" : null,
    productionEmissionsClaimReservedBySubmissionId: reserved ? "submission" : null,
  }])).get("ready")!;
  assert(result.status === "ready");
  expect(result.lines[0].lineFile?.needsFile).toBe(!locked);
  expect(result.lines[0].lineFile?.locked).toBe(locked);
  // Only a claimed batch with an open correction window can replace its set; this fixture holds no files.
  expect(result.lines[0].lineFile?.canReplace).toBe(false);
  expect(result.lines[0].blocker?.code).toBe(locked ? undefined : "lineMissingEvidence");
  if (claimed) expect(listEmissionEntryDraftContenders).toHaveBeenCalledWith(ctx, ["ready"], undefined, undefined, { savedOnly: true });
  else expect(listEmissionEntryDraftContenders).not.toHaveBeenCalled();
});

it("offers Replace in the correction window only for a set Isometric holds a file of", async () => {
  vi.mocked(listEmissionEntryDraftContenders).mockResolvedValue([{
    contenderKind: "correction", removalId: "sent", createdAt: "2026-01-01",
    creditBatchIds: ["ready"], window: { start: "2026-01-01", end: "2026-02-01" },
  }] as never);
  const proof = structuredClone(observation);
  Object.assign(proof.lineSources.electricity, { automaticSource: "run-electricity", filePolicy: "lineFile" });
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([proof] as never);
  vi.mocked(loadBatchesEmissionAutomaticFacts).mockResolvedValue({ ready: { automaticFigures: { "run-electricity": { magnitude: "5", unit: "kWh" } } } });
  vi.mocked(listEmissionLineFilesForBatches).mockResolvedValue(["sent-file", "new-file"].map(id => ({
    anchor: { id: "anchor", componentId: "electricity", creditBatchId: "ready", version: 2 }, document: { id, fileName: id + ".pdf", version: 1 },
  })) as never);
  vi.mocked(listDocumentUploadsForDocuments).mockResolvedValue([{ documentId: "sent-file" }] as never);
  const result = (await loadBatchesEmissionLines(ctx, [{ ...batches[0], productionEmissionsClaimedByRemovalId: "sent" }])).get("ready")!;
  assert(result.status === "ready");
  expect(listDocumentUploadsForDocuments).toHaveBeenCalledWith(ctx, "isometric", ["sent-file", "new-file"]);
  expect(result.lines[0].lineFile).toMatchObject({ locked: false, canReplace: true,
    documents: [{ id: "sent-file", sent: true }, { id: "new-file", sent: false }] });
});
