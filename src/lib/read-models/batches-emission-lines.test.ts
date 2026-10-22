import { assert, beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";

vi.mock("@/data-access/emission-entries", () => ({ listEmissionEntriesForBatches: vi.fn() }));
vi.mock("@/data-access/emission-line-comments", () => ({ listEmissionLineCommentsForBatches: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ getLatestTemplateObservations: vi.fn(), getTemplateObservationsByIds: vi.fn() }));
vi.mock("@/data-access/batch-emission-automatic-figures", () => ({ loadBatchesEmissionAutomaticFacts: vi.fn() }));
vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn() }));
import { listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { listEmissionLineCommentsForBatches } from "@/data-access/emission-line-comments";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "@/data-access/removal-template-observations";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { loadBatchesEmissionLines } from "./batches-emission-lines";

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
  expect(getTemplateObservationsByIds).toHaveBeenCalledExactlyOnceWith(ctx, ["previous"]);
  expect(loadBatchesEmissionAutomaticFacts).toHaveBeenCalledExactlyOnceWith(ctx, ["ready"]);
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
