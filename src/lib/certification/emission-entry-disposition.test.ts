import { describe, expect, it } from "vitest";
import { deriveEmissionEntryDisposition, type EmissionEntryDispositionInput as Input } from "./emission-entry-disposition";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { REMOVAL_DELETION_LEASE_KEY } from "./removal-deletion-lease";

const NOW = Date.parse("2026-04-03T12:00:00Z");
const MASS_KG = 100;

function observationFixture(): Input["previous"][number] {
  return { id: "observation", externalTemplateId: "template",
    organizationId: "org", provider: "isometric", externalProjectId: "project",
    semanticFingerprint: "semantic", fullFingerprint: "full", version: 1,
    reviewedAt: null, reviewedByUserId: null,
    firstObservedAt: new Date(NOW), lastObservedAt: new Date(NOW), enrichedAt: new Date(NOW),
    createdAt: new Date(NOW), updatedAt: new Date(NOW),
    definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "Group", description: "", components: [
      { id: "line", displayName: "Electricity", description: null, blueprintKey: "grid_electricity_use",
        inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] },
    ] }] }, enrichment: { line: { electricity_use: { unit: "kWh" } } },
    lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
  };
}

function rollupsFixture(batch: Input["selected"][number]["batch"]): Input["rollups"] {
  return { [batch.id]: {
    batch: { ...batch, durabilityOption: "1000_year" },
    feedstockType: { id: "feedstock-type", name: null, usage: null, isometricFeedstockTypeId: null },
    appliedWeightTons: 0,
    lineageFacts: {
      batchId: batch.id, productionRunIds: ["run"], applicationIds: [], applications: [], appliedWeightTons: 0,
      runs: [{ id: "run", code: "PR-run", status: null, date: new Date("2026-03-15T00:00:00Z"),
        biocharDryMassKg: MASS_KG, feedstockMassDryKg: null, reactor: null, feedstocks: [] }],
    },
  } };
}

function fixture(): Input {
  const batch = { id: "origin", code: "CB-origin", facilityId: "facility", startDate: "2026-03-01", endDate: "2026-03-31", removalTemplateId: "template" } as Input["selected"][number]["batch"];
  const next = { ...batch, id: "next", code: "CB-next" };
  const removal = { id: "receiver", code: "RM-receiver", createdAt: new Date("2026-03-01"), metadata: {}, ghgStatementId: "statement" } as Input["removals"][number];
  const entry = { id: "entry", observationId: "observation", creditBatchId: batch.id, componentId: "line", kind: "value", lineRule: "additive",
    occurredOn: "2026-03-15", createdAt: new Date("2026-04-02"), deletedAt: null, sentByRemovalId: null,
    heldForRemovalId: null, sendReservedBySubmissionId: null, confirmedForRemovalId: null, documentCount: 1,
    values: [{ inputKey: "electricity_use", magnitude: "12", unit: "kWh" }],
  } as Input["stored"][number];
  const observation = observationFixture();
  const selected = [{ entry, batch, timezone: "UTC" }];
  return { organizationId: "org", facilityId: "facility", nowMs: NOW, selected, candidates: selected, stored: [entry],
    draftMembers: [{ removal, batch: next, applicationDate: new Date("2026-03-31T00:00:00Z") }], originMembers: [],
    rollups: rollupsFixture(batch),
    slices: [{ creditBatchId: batch.id, removalId: "owner", allocatedDryMassKg: MASS_KG }] as Input["slices"],
    previous: [observation], observations: [observation], reservations: [], removals: [removal],
    memberships: [{ removalId: removal.id, batch: next }], attempts: [], lineage: [], correctionLineages: new Map() };
}
function attempt(input: Input, status: Input["attempts"][number]["status"] = "draft") {
  const row = { id: "attempt", localEntityId: "receiver", status, lockedAt: new Date(NOW), metadata: {}, submittedAt: null } as Input["attempts"][number];
  input.attempts.push(row);
  return row;
}
function reserve(input: Input, status: Input["reservations"][number]["status"] = "draft", expired = false) {
  input.stored[0].sendReservedBySubmissionId = "attempt";
  input.reservations.push({ submissionId: "attempt", removalId: "receiver", status,
    lockedAt: new Date(NOW - (expired ? LOCK_TTL_MS : 0)), metadata: {} });
}
function correction(input: Input) {
  const removal = { ...input.removals[0], id: "owner", code: "RM-owner" };
  input.removals.push(removal);
  input.originMembers = [{ removal, batch: input.selected[0].batch, applicationDate: new Date("2026-03-31T00:00:00Z") }];
  input.lineage = [{ id: removal.id, submissions: [{ status: "submitted", externalId: "remote", submittedAt: "2026-04-01T00:00:00Z" }],
    statements: [{ id: "statement", status: "FAILED_VERIFICATION", fresh: false, submittedToVerifier: true,
      returnedAt: "2026-04-02T00:00:00Z", removalExternalIds: ["remote"] }] }];
  input.correctionLineages.set("origin", input.lineage);
  Object.assign(attempt(input, "submitted"), { localEntityId: "owner", submittedAt: new Date("2026-04-01") });
}
type Case = { name: string; change: (input: Input) => void; accepted: boolean };

describe("draft contenders from loaded rows", () => {
  it.each<Case>([
    { name: "accepted", change: () => {}, accepted: true },
    { name: "live other attempt", change: i => { attempt(i); }, accepted: false },
    { name: "claimed attempt ignored", change: i => { attempt(i); i.claimedAttempt = { removalId: "receiver", submissionId: "attempt" }; }, accepted: true },
    { name: "fresh deletion lease", change: i => { i.draftMembers[0].removal.metadata = { [REMOVAL_DELETION_LEASE_KEY]: new Date(NOW).toISOString() }; }, accepted: false },
    { name: "expired deletion lease", change: i => { i.draftMembers[0].removal.metadata = { [REMOVAL_DELETION_LEASE_KEY]: new Date(NOW - LOCK_TTL_MS).toISOString() }; }, accepted: true },
    { name: "two template pins", change: i => { const row = i.draftMembers[0]; i.draftMembers.push({ ...row, batch: { ...row.batch, id: "second", removalTemplateId: "other" } }); }, accepted: false },
    { name: "no window", change: i => { i.draftMembers[0].applicationDate = new Date("2026-02-28T00:00:00Z"); }, accepted: false },
    { name: "other facility", change: i => { i.draftMembers[0].batch.facilityId = "other"; }, accepted: false },
  ])("$name", ({ change, accepted }) => {
    const input = fixture(); change(input);
    const result = deriveEmissionEntryDisposition(input);
    expect(result.contenders.map(row => row.removalId)).toEqual(accepted ? ["receiver"] : []);
  });
});

it.each([
  { status: null, submitted: false, accepted: true },
  { status: "FAILED_VERIFICATION", submitted: false, accepted: true },
  { status: "DRAFT", submitted: true, accepted: true },
  { status: "DRAFT", submitted: false, accepted: false },
  { status: "VERIFIED", submitted: true, accepted: false },
  { status: "missing", submitted: false, accepted: true },
])("correction contender: $status, submitted=$submitted", ({ status, submitted, accepted }) => {
  const input = fixture(); correction(input);
  if (status === "missing") input.lineage[0].statements = [];
  else Object.assign(input.lineage[0].statements[0], { status, submittedToVerifier: submitted });
  expect(deriveEmissionEntryDisposition(input).ownContenders.filter(row => row.contenderKind === "correction").map(row => row.removalId))
    .toEqual(accepted ? ["owner"] : []);
});

it.each([
  { status: "draft" as const, expired: false, retained: true, inactive: false },
  { status: "draft" as const, expired: true, retained: true, inactive: true },
  { status: "accepted" as const, expired: true, retained: true, inactive: false },
  { status: "rejected" as const, expired: true, retained: false, inactive: true },
  { status: "superseded" as const, expired: true, retained: false, inactive: true },
])("reservation $status expired=$expired", ({ status, expired, retained, inactive }) => {
  const input = fixture(); reserve(input, status, expired);
  const entry = deriveEmissionEntryDisposition(input).entries[0];
  expect(entry.reservedByRemovalId).toBe(retained ? "receiver" : null);
  expect(entry.reservationKnownInactive).toBe(inactive);
  expect(entry.reportedIn).toBeNull();
});

it.each(["held", "retained", "sent"])("%s destination in another batch", kind => {
  const input = fixture(); input.candidates = []; input.draftMembers = [];
  if (kind === "retained") reserve(input, "draft", true);
  else if (kind === "held") input.stored[0].heldForRemovalId = "receiver";
  else input.stored[0].sentByRemovalId = "receiver";
  const entry = deriveEmissionEntryDisposition(input).entries[0];
  const destination = { removalId: "receiver", removalCode: "RM-receiver", creditBatchCodes: ["CB-next"], creditBatchIds: ["next"], anotherCreditBatch: true };
  expect(entry.carry.receiver).toEqual(kind === "sent" ? null : destination);
  expect(entry.reportedIn).toEqual(kind === "sent" ? destination : null);
});

it.each<Case>([
  { name: "fully applied", change: () => {}, accepted: true },
  { name: "remaining mass", change: i => { i.slices[0].allocatedDryMassKg = 0; }, accepted: false },
  { name: "unknown mass", change: i => { i.rollups = {}; }, accepted: false },
  { name: "not a candidate", change: i => { i.candidates = []; }, accepted: false },
  { name: "future end date", change: i => { i.selected[0].batch.endDate = "2026-04-30"; }, accepted: false },
  { name: "period not ended on explicit clock", change: i => { i.nowMs = Date.parse("2026-03-31T12:00:00Z"); }, accepted: false },
])("carry eligibility: $name", ({ change, accepted }) => {
  const input = fixture(); change(input);
  expect(deriveEmissionEntryDisposition(input).entries[0].carry.receiver?.removalId ?? null).toBe(accepted ? "receiver" : null);
});

it.each<Case>([
  { name: "returned owner", change: () => {}, accepted: true },
  { name: "deleted", change: i => { i.stored[0].deletedAt = new Date(NOW); }, accepted: false },
  { name: "zero", change: i => { i.stored[0].kind = "zero"; }, accepted: false },
  { name: "sent", change: i => { i.stored[0].sentByRemovalId = "owner"; }, accepted: false },
  { name: "held", change: i => { i.stored[0].heldForRemovalId = "owner"; }, accepted: false },
  { name: "live reservation", change: i => { reserve(i); }, accepted: false },
  { name: "expired draft reservation", change: i => { reserve(i, "draft", true); }, accepted: false },
  { name: "unknown reservation", change: i => { i.stored[0].sendReservedBySubmissionId = "missing"; }, accepted: false },
  { name: "terminal inactive reservation", change: i => { reserve(i, "rejected", true); }, accepted: true },
  { name: "no correction owner", change: i => { i.lineage = []; }, accepted: false },
  { name: "owner sent after entry", change: i => { i.attempts[0].submittedAt = new Date(NOW); }, accepted: false },
  { name: "different Removal sent before entry", change: i => { i.attempts[0].localEntityId = "other"; }, accepted: false },
  { name: "owner never sent", change: i => { i.attempts[0].submittedAt = null; }, accepted: false },
  { name: "missing union", change: i => { i.correctionLineages.clear(); }, accepted: false },
  { name: "unknown union", change: i => { i.correctionLineages.set("origin", null); }, accepted: false },
  { name: "unknown statement", change: i => { i.lineage[0].statements[0].status = null; }, accepted: false },
  { name: "blocking shared holder", change: i => { i.lineage.push({ id: "shared", submissions: [], statements: [{ id: "verified", status: "VERIFIED", fresh: false, submittedToVerifier: true }] }); }, accepted: false },
  { name: "missing Removal", change: i => { i.removals = i.removals.filter(row => row.id !== "owner"); }, accepted: false },
])("revision announcement: $name", ({ change, accepted }) => {
  const input = fixture(); correction(input); change(input);
  expect(deriveEmissionEntryDisposition(input).entries[0].revisionOf).toEqual(accepted ? { removalId: "owner", removalCode: "RM-owner" } : null);
});

it("keeps earlier Removal display and batches, and omits entries without observations", () => {
  const input = fixture(); correction(input);
  const result = deriveEmissionEntryDisposition(input);
  expect(result.entries[0]).toMatchObject({ earlierRemovalId: "owner", earlierRemovalCode: "RM-owner", creditBatchCode: "CB-origin", entryObservation: input.previous[0] });
  expect(result.batches).toEqual([input.selected[0].batch]);
  input.previous = [];
  expect(deriveEmissionEntryDisposition(input).entries).toEqual([]);
});
