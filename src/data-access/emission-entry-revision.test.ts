import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { loadFacilityEmissionEntryCarry } from "./emission-entry-carry";

const mocks = vi.hoisted(() => ({ select: vi.fn(), candidates: vi.fn(), owned: vi.fn(), members: vi.fn(),
  hydrate: vi.fn(), reservations: vi.fn(), observations: vi.fn(), rollups: vi.fn(), lineage: vi.fn(), registry: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("./emission-entry-carry-queries", () => ({ listCarryCandidates: mocks.candidates,
  listOwnedCarryEntries: mocks.owned, listCarryRemovalMembers: mocks.members }));
vi.mock("./emission-entries", () => ({ hydrateEmissionEntries: mocks.hydrate }));
vi.mock("./emission-entry-contenders", () => ({ loadEmissionEntryReservations: mocks.reservations }));
vi.mock("./removal-template-observations", () => ({ getTemplateObservationsByIds: mocks.observations,
  getLatestTemplateObservations: mocks.observations }));
vi.mock("./credit-batch-accounting", () => ({ loadCreditBatchRollups: mocks.rollups }));
vi.mock("./record-lock-lineage", () => ({ readRecordLockLineage: mocks.lineage }));
vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: mocks.registry }));
const ctx = makeTestOrgContext();
const observation = { id: "observation", externalTemplateId: "template",
  definition: { groups: [{ id: "group", key: "pyrolysis", displayName: "Group", description: "",
    components: [{ id: "line", displayName: "Electricity", description: null, blueprintKey: "grid_electricity_use",
      inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] }] }] },
  enrichment: { line: { electricity_use: { unit: "kWh" } } },
  lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } } };
const batch = { id: "batch", code: "CB-009", startDate: "2026-09-01", endDate: "2026-09-30", removalTemplateId: "template" };
const removal = { id: "own", code: "RM-009", createdAt: new Date("2026-09-01"), ghgStatementId: "statement" };
const entry = { id: "entry", creditBatchId: batch.id, componentId: "line", observationId: observation.id,
  contentRevision: 1, kind: "value", lineRule: "additive", occurredOn: "2026-09-14", createdAt: new Date("2026-10-02"),
  deletedAt: null, sentByRemovalId: null, heldForRemovalId: null, sendReservedBySubmissionId: null,
  values: [{ inputKey: "electricity_use", magnitude: "120", unit: "kWh" }], evidenceDocumentIds: ["file"], documentCount: 1 };
const statement = { id: "statement", status: "FAILED_VERIFICATION", submittedToVerifier: true, fresh: false };
const query = (rows: object[]) => ({ from: () => ({ where: async () => rows }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.candidates.mockResolvedValue([{ entry, batch, timezone: "UTC" }]); mocks.owned.mockResolvedValue([]);
  mocks.members.mockImplementation((_ctx, _facility, _executor, origins) => Promise.resolve(origins
    ? [{ removal, batch, applicationDate: "2026-09-30" }] : []));
  mocks.hydrate.mockResolvedValue([entry]); mocks.reservations.mockResolvedValue([]);
  mocks.observations.mockResolvedValue([observation]);
  mocks.rollups.mockResolvedValue({ batch: { lineageFacts: { runs: [{ biocharDryMassKg: 190 }] } } });
  mocks.lineage.mockResolvedValue([{ id: "own", statements: [statement], submissions: [] }]);
  mocks.select.mockReturnValueOnce(query([{ creditBatchId: batch.id, removalId: removal.id, allocatedDryMassKg: 190 }]))
    .mockReturnValueOnce(query([removal])).mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ where: async () => [] }) }) })
    .mockReturnValueOnce(query([{ id: "sent", localEntityId: removal.id, submittedAt: new Date("2026-10-01") }]));
});

it.each([statement, { ...statement, status: "DRAFT" }])("exposes the confirmed revision using persisted facts only: $status", async returned => {
  mocks.lineage.mockResolvedValue([{ id: "own", statements: [returned], submissions: [] }]);
  const result = await loadFacilityEmissionEntryCarry(ctx, "facility");
  expect(result.entries[0]).toMatchObject({ revisionOf: { removalId: "own", removalCode: "RM-009" },
    earlierRemovalId: "own", carry: { receiver: null, waitingReason: null } });
  expect(result.ownContenders[0]).toMatchObject({ contenderKind: "correction", removalId: "own" });
  expect(mocks.registry).not.toHaveBeenCalled();
});

it.each([null, "DRAFT", "VERIFIED", "AWAITING_VERIFICATION"])("does not call status %s a confirmed return", async status => {
  mocks.lineage.mockResolvedValue([{ id: "own", statements: [{ ...statement, status, submittedToVerifier: false }], submissions: [] }]);
  const result = await loadFacilityEmissionEntryCarry(ctx, "facility");
  expect(result.entries[0].revisionOf).toBeNull();
  if (status === null) expect(result.ownContenders[0]).toMatchObject({ contenderKind: "correction", removalId: "own" });
});

it("keeps missing statements as conservative owners without announcing a revision", async () => {
  mocks.lineage.mockResolvedValue([{ id: "own", statements: [], submissions: [] }]);
  const result = await loadFacilityEmissionEntryCarry(ctx, "facility");
  expect(result.entries[0].revisionOf).toBeNull();
  expect(result.ownContenders[0]).toMatchObject({ contenderKind: "correction", removalId: "own" });
});

it.each([{ kind: "zero" }, { deletedAt: new Date() }, { sentByRemovalId: "own" }, { heldForRemovalId: "own" },
  { sendReservedBySubmissionId: "unknown" }, { createdAt: new Date("2026-09-30") }, { occurredOn: "2026-10-01" },
])("requires a free value recorded after its correction owner's sent attempt: %j", async patch => {
  mocks.hydrate.mockResolvedValue([{ ...entry, ...patch }]);
  expect((await loadFacilityEmissionEntryCarry(ctx, "facility")).entries[0].revisionOf).toBeNull();
});

it.each(["draft", "submitted"])("does not announce a revision for a retained %s reservation", async status => {
  mocks.hydrate.mockResolvedValue([{ ...entry, sendReservedBySubmissionId: "reserved" }]);
  mocks.reservations.mockResolvedValue([{ submissionId: "reserved", removalId: "receiver", status, lockedAt: new Date(0), metadata: {} }]);
  expect((await loadFacilityEmissionEntryCarry(ctx, "facility")).entries[0].revisionOf).toBeNull();
});

it("allows a known inactive terminal reservation to release its display destination", async () => {
  mocks.hydrate.mockResolvedValue([{ ...entry, sendReservedBySubmissionId: "released" }]);
  mocks.reservations.mockResolvedValue([{ submissionId: "released", removalId: "receiver", status: "rejected", lockedAt: null, metadata: {} }]);
  expect((await loadFacilityEmissionEntryCarry(ctx, "facility")).entries[0].revisionOf).toEqual({ removalId: "own", removalCode: "RM-009" });
});
