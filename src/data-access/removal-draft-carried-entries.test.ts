import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { loadDraftRemovalCarriedEntries } from "./removal-draft-carried-entries";
import { loadRemovalEntryContext } from "@/fn/certification/removal-entry-context";
import { loadFacilityEmissionEntryCarry } from "./emission-entry-carry";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";

const mocks = vi.hoisted(() => ({ batches: vi.fn(), observations: vi.fn(), carry: vi.fn(), rollups: vi.fn(), facts: vi.fn(), contenders: vi.fn(), latest: vi.fn() }));
vi.mock("./certifier-removals", () => ({ getCreditBatchesByRemovalId: mocks.batches }));
vi.mock("./removal-template-observations", () => ({ getLatestTemplateObservations: mocks.observations }));
vi.mock("./emission-entry-carry", () => ({ loadFacilityEmissionEntryCarry: mocks.carry }));
vi.mock("./credit-batch-accounting", () => ({ loadCreditBatchRollups: mocks.rollups }));
vi.mock("./emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: mocks.facts }));
vi.mock("./emission-entry-contenders", () => ({ listEmissionEntryDraftContenders: mocks.contenders, loadEmissionEntryReservations: vi.fn(async () => []) }));
vi.mock("./certification-submissions", () => ({ getLatestSubmission: mocks.latest }));
const ctx = makeTestOrgContext();
const observation = {
  id: "observation", externalTemplateId: "template", semanticFingerprint: "facts",
  definition: { groups: [{ components: [{ id: "line", displayName: "Electricity", blueprintKey: "energy", inputs: [{ key: "energy", type: "monitored", quantityKind: "energy" }] }] }] },
  enrichment: { line: { energy: { unit: "kWh" } } },
  lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
} as unknown as RemovalTemplateObservation;
const batches = [{ id: "member", code: "CB-member", removalTemplateId: "template", startDate: "2026-03-01", endDate: "2026-03-31" }];
const receiver = { removalId: "draft", removalCode: "RM-draft", creditBatchIds: ["member"], creditBatchCodes: ["CB-member"], anotherCreditBatch: true };
function candidate(id: string, occurredOn = "2026-02-01") {
  return { id, creditBatchId: "origin", creditBatchCode: "CB-origin", componentId: "line", contentRevision: 1,
    kind: "value", lineRule: "additive", occurredOn, deletedAt: null, sentByRemovalId: null,
    heldForRemovalId: null, sendReservedBySubmissionId: null, confirmedForRemovalId: null, counts: true,
    values: [{ inputKey: "energy", magnitude: "12", unit: "kWh" }], evidenceDocumentIds: ["file"],
    carry: { receiver, waitingReason: null }, reportedIn: null, entryObservation: observation,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.batches.mockResolvedValue(batches); mocks.observations.mockResolvedValue([observation]);
  mocks.rollups.mockResolvedValue({ member: { batch: {}, lineageFacts: { applications: [{ applicationDate: "2026-03-31" }] } } });
  mocks.facts.mockResolvedValue({ entries: [], previousObservations: new Map() });
  mocks.contenders.mockResolvedValue([]); mocks.latest.mockResolvedValue(null);
});
it("matches the full context for real nonempty carry candidates, filtering out unselected entries", async () => {
  const entries = [candidate("included"), candidate("outside-window", "2026-04-01"),
    { ...candidate("wrong-unit"), unitMismatch: true, values: [{ inputKey: "energy", magnitude: "12", unit: "kg" }] },
    { ...candidate("other-draft"), carry: { receiver: { ...receiver, removalId: "other" } } }];
  const carry = { entries, contenders: [], ownContenders: [], batches: [] };
  mocks.carry.mockResolvedValue(carry);
  const narrow = await loadDraftRemovalCarriedEntries(ctx, "draft", "facility");
  const full = await loadRemovalEntryContext(ctx, { removalId: "draft", memberBatches: batches,
    lineages: [{ application: { applicationDate: "2026-03-31" } }] } as never,
  { batchFacts: { member: { entries: [], previousObservations: new Map(), automaticFigures: {}, contenders: [] } }, carryContext: carry } as never,
  { templatesById: { template: { observation } } });
  expect(narrow).toEqual(full!.contributions.carriedEntries);
  expect(narrow.map(entry => entry.entryId)).toEqual(["included"]);
  expect(loadFacilityEmissionEntryCarry).toHaveBeenCalledExactlyOnceWith(ctx, "facility", undefined, undefined, { ownedRemovalId: "draft" });
});
it("honors a reserved attempt's empty frozen set like the full context", async () => {
  mocks.carry.mockResolvedValue({ entries: [candidate("late")], contenders: [], ownContenders: [], batches: [] });
  mocks.latest.mockResolvedValue({ id: "attempt", status: "draft", metadata: {}, payloadSnapshot: { frozenEntrySet: [] } });
  mocks.rollups.mockResolvedValue({ member: { batch: { productionEmissionsClaimReservedBySubmissionId: "attempt" }, lineageFacts: { applications: [] } } });
  expect(await loadDraftRemovalCarriedEntries(ctx, "draft", "facility")).toEqual([]);
});
