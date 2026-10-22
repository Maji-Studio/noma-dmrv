import { beforeEach, expect, it, vi } from "vitest";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import type { BatchEmissionContext } from "./batch-emission-context";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { loadEntrySourceContributions } from "./emission-entry-source-context";

const mocks = vi.hoisted(() => ({
  scope: vi.fn(), observations: vi.fn(), facts: vi.fn(), latest: vi.fn(), registry: vi.fn(),
}));
vi.mock("./removal-scope", () => ({ resolveScopeForRemoval: mocks.scope }));
vi.mock("@/data-access/removal-template-observations", () => ({ getLatestTemplateObservations: mocks.observations }));
vi.mock("./batch-emission-context", () => ({ loadBatchEmissionContext: mocks.facts }));
vi.mock("@/data-access/certification-submissions", () => ({ getLatestSubmission: mocks.latest }));
vi.mock("@/data-access/emission-entry-contenders", () => ({ loadEmissionEntryReservations: vi.fn(async () => []) }));
// Every live registry list fails. The picker must still derive candidates locally.
vi.mock("./facility-certifier-facts", () => ({ loadFacilityCertifierFacts: mocks.registry }));

const ctx = makeTestOrgContext();
const timestamp = new Date("2026-03-31");
const observation: RemovalTemplateObservation = {
  organizationId: ctx.organizationId, provider: "isometric", externalProjectId: "project", version: 1,
  fullFingerprint: "full", createdAt: timestamp, updatedAt: timestamp, enrichedAt: timestamp,
  firstObservedAt: timestamp, lastObservedAt: timestamp, reviewedAt: timestamp, reviewedByUserId: null,
  id: "observation", externalTemplateId: "template", semanticFingerprint: "fingerprint",
  definition: { groups: [{ id: "group", key: "operating", displayName: "Operating", description: "", components: [{ id: "component", displayName: "Diesel for machinery", description: null, blueprintKey: "energy",
    inputs: [{ key: "energy", type: "monitored", quantityKind: "energy" }] }] }] },
  enrichment: { component: { energy: { unit: "kWh" } } },
  lineSources: { component: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
};
const scope = { removalId: "removal", facilityId: "facility",
  memberBatches: [{ id: "batch", code: "CB-26-001", removalTemplateId: "template", startDate: "2026-03-01" }],
  lineages: [{ application: { applicationDate: "2026-03-31" } }],
};
const facts: BatchEmissionContext = { batch: {
  entries: [{ id: "entry", creditBatchId: "batch", componentId: "component", contentRevision: 1,
    kind: "value", lineRule: "additive", occurredOn: "2026-03-14", counts: true,
    deletedAt: null, sentByRemovalId: null, replacesEntryId: null, heldForRemovalId: null, sendReservedBySubmissionId: null, confirmedForRemovalId: null,
    organizationId: ctx.organizationId, removalTemplateId: "template", observationId: "observation",
    inputShape: [], note: null, createdBy: null, version: 1, createdAt: timestamp, updatedAt: timestamp,
    documentCount: 1, reason: null, hasEvidence: true, unitMismatch: false, total: { magnitude: "2", unit: "kWh" }, canConfirm: false,
    evidenceDocumentIds: ["file"], values: [{ id: "value", organizationId: ctx.organizationId, entryId: "entry",
      massDistanceDetail: null, inputKey: "energy", magnitude: "2", unit: "kWh" }] }],
  previousObservations: new Map(), automaticFigures: {},
  contenders: [{ contenderKind: "draft", removalId: "removal", createdAt: "2026-03-31", creditBatchIds: ["batch"],
    window: { start: "2026-03-01", end: "2026-03-31" } }],
} };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.scope.mockResolvedValue(scope);
  mocks.observations.mockResolvedValue([observation]);
  mocks.facts.mockResolvedValue(structuredClone(facts));
  mocks.latest.mockResolvedValue(null);
  mocks.registry.mockRejectedValue(new TypeError("Registry unavailable"));
});
it("uses persisted pinned observations while registry calls fail", async () => {
  const result = await loadEntrySourceContributions(ctx, "removal");
  expect(result?.manifest).toMatchObject([{ componentId: "component", componentDisplayName: "Diesel for machinery",
    entries: [{ entryId: "entry", occurredOn: "2026-03-14", creditBatchCode: "CB-26-001", evidenceDocumentIds: ["file"] }],
  }]);
  expect(mocks.observations).toHaveBeenCalledExactlyOnceWith(ctx, "isometric", ["template"]);
  expect(mocks.facts).toHaveBeenCalledWith(ctx, "facility", scope.memberBatches,
    { templatesById: { template: { observation } } }, undefined, true, undefined, "removal");
  expect(mocks.registry).not.toHaveBeenCalled();
});
it("returns no entry contributions before a local observation exists", async () => {
  mocks.observations.mockResolvedValue([]);
  mocks.facts.mockResolvedValue({});
  expect(await loadEntrySourceContributions(ctx, "removal")).toBeUndefined();
  expect(mocks.registry).not.toHaveBeenCalled();
});
it("retains the reserved attempt's frozen set instead of adding a later entry", async () => {
  mocks.latest.mockResolvedValue({ id: "attempt", status: "draft", metadata: {}, payloadSnapshot: { frozenEntrySet: [] } });
  mocks.facts.mockResolvedValue({ batch: { ...facts.batch, productionReservationSubmissionId: "attempt" } });
  expect((await loadEntrySourceContributions(ctx, "removal"))?.manifest).toEqual([]);
});
it("does not freeze entries from a crashed unreserved draft", async () => {
  mocks.latest.mockResolvedValue({ id: "attempt", status: "draft", metadata: {}, payloadSnapshot: { frozenEntrySet: [] } });
  expect((await loadEntrySourceContributions(ctx, "removal"))?.entrySet).toEqual([{ entryId: "entry", contentRevision: 1 }]);
});
it("keeps local read failures visible", async () => {
  mocks.observations.mockRejectedValue(new Error("Local read failed"));
  await expect(loadEntrySourceContributions(ctx, "removal")).rejects.toThrow("Local read failed");
});
