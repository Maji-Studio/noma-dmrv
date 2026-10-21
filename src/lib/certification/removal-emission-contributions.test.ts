import { deriveRemovalBatchEmissionLines } from "./removal-emission-lines";
import { describe, expect, it } from "vitest";
import { deriveRemovalEntryContributions, deriveRemovalEntryWindow, entriesWithoutRemoval, isLiveEntryReservation, removalEntryOwner, type EntryContender, type RemovalEntryFact } from "./removal-emission-contributions";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import { reviewPayloadHash } from "./removal-review-hash";

const first: EntryContender = { contenderKind: "draft", removalId: "r1", createdAt: "2026-01-01", creditBatchIds: ["b1"], window: { start: "2026-01-01", end: "2026-02-01" } };
const second: EntryContender = { ...first, removalId: "r2", window: { ...first.window, end: "2026-03-01" } };
function entry(overrides: Partial<RemovalEntryFact> = {}): RemovalEntryFact {
  return { id: "e1", creditBatchId: "b1", componentId: "c1", contentRevision: 1, kind: "value", lineRule: "additive",
    occurredOn: "2026-01-10", deletedAt: null, sentByRemovalId: null, sendReservedBySubmissionId: null,
    confirmedForRemovalId: null, counts: true, evidenceDocumentIds: ["doc1"], values: [{ inputKey: "energy", magnitude: "1.20", unit: "kWh" }], ...overrides };
}
function derive(entries: RemovalEntryFact[], overrides: Partial<Parameters<typeof deriveRemovalEntryContributions>[0]> = {}) {
  return deriveRemovalEntryContributions({ removalId: "r1", memberBatchIds: ["b1"], window: first.window, contenders: [first, second], entries,
    lineSources: { c1: { scope: "operating", origin: "reviewed", entryPolicy: "additive" } }, monitoredInputs: [{ componentId: "c1", inputKey: "energy", unit: "kWh" }], ...overrides });
}
describe("Removal entry windows and ownership", () => {
  it("keeps application-day entries west of UTC and includes the batch start", () => {
    // The application represents Feb 1 even at a facility in America/Los_Angeles.
    const window = deriveRemovalEntryWindow([{ startDate: "2026-01-01" }], [new Date("2026-02-01T00:00:00Z")]);
    expect(window).toEqual(first.window);
    expect(derive([entry({ occurredOn: "2026-02-01" })], { window }).selectedEntryIds).toEqual(["e1"]);
    expect(derive([entry({ occurredOn: "2026-01-01" })], { window }).selectedEntryIds).toEqual(["e1"]);
    expect(deriveRemovalEntryWindow([{ startDate: "2026-01-02" }, { startDate: "2026-01-01" }], ["2026-01-10", "2026-02-01"])).toEqual(first.window);
    expect(deriveRemovalEntryWindow([], [])).toBeNull();
  });
  it("orders overlapping windows by end, creation, then id regardless of input order", () => {
    const earlierCreated = { ...first, removalId: "a", createdAt: "2025-12-01" };
    expect(removalEntryOwner(entry(), [second, first])).toBe("r1");
    expect(removalEntryOwner(entry(), [first, earlierCreated])).toBe("a");
    expect(removalEntryOwner(entry(), [{ ...first, removalId: "b" }, { ...first, removalId: "a" }])).toBe("a");
  });
  it("honours existing claims and reservations before contender order", () => {
    expect(removalEntryOwner(entry({ sentByRemovalId: "r2" }), [first, second])).toBe("r2");
    expect(removalEntryOwner(entry({ reservedByRemovalId: "r2", sendReservedBySubmissionId: "s2" }), [first, second])).toBe("r2");
    expect(derive([entry({ sentByRemovalId: "r1" })], { contenders: [] }).selectedEntryIds).toEqual(["e1"]);
    expect(derive([entry({ sentByRemovalId: "r2" })]).selectedEntryIds).toEqual([]);
  });
  it("sends a backdated or later entry through a 1000-year batch's second Removal after the first is submitted", () => {
    for (const occurredOn of ["2026-01-01", "2026-02-15"]) {
      expect(derive([entry({ occurredOn })], { removalId: "r2", window: second.window, contenders: [second] }).selectedEntryIds).toEqual(["e1"]);
    }
  });
  it.each(["2025-12-31", "2026-03-02"])("blocks an entry outside every window: %s", (occurredOn) => {
    expect(derive([entry({ occurredOn })]).blockers).toEqual([{ code: "entryHasNoRemoval", message: "No Removal can carry this entry yet. Change its date to fit the Removal period, or wait for a later Removal.", fixTarget: "emissions", creditBatchId: "b1", lineRef: { componentId: "c1", displayName: "c1" } }]);
  });
  it("ignores tombstones and nonmember batches", () => {
    expect(derive([entry({ deletedAt: new Date() }), entry({ id: "e2", creditBatchId: "foreign" })]).selectedEntryIds).toEqual([]);
  });
});
describe("whole entry contributions", () => {
  it("never pools zeros, and sends them without files", () => {
    const zero = entry({ kind: "zero", confirmedForRemovalId: "r2", evidenceDocumentIds: [], values: [] });
    expect(derive([zero]).manifest).toEqual([]);
    const result = derive([zero], { removalId: "r2", window: second.window });
    expect(result.inputs[0].value).toEqual({ magnitude: "0", unit: "kWh" });
    expect(result.manifest[0].entries[0]).toMatchObject({ kind: "zero", evidenceDocumentIds: [] });
    expect(result.blockers).toEqual([]);
  });
  it("counts a new value instead of a stale zero on the same batch", () => {
    const result = derive([entry({ id: "zero", kind: "zero", confirmedForRemovalId: "r1", values: [] }), entry()]);
    expect(result.selectedEntryIds).toEqual(["e1"]);
  });
  it("adds decimals exactly and sorts the manifest deterministically", () => {
    const entries = [entry({ id: "z", values: [{ inputKey: "energy", magnitude: "0.1", unit: "kWh" }] }), entry()];
    const result = derive(entries);
    expect(result.inputs[0].value.magnitude).toBe("1.3");
    expect(result.manifest).toEqual(derive([...entries].reverse()).manifest);
    expect(result.manifest[0].entries[0].value.magnitude).toBe("1.2");
  });
  it("requires evidence and current entry compatibility", () => {
    expect(derive([entry({ evidenceDocumentIds: [] })]).blockers[0].code).toBe("entryMissingEvidence");
    expect(derive([entry({ counts: false })]).blockers[0].code).toBe("lineNeedsReview");
  });
  it.each(["forbidden", "unassigned"] as const)("cannot authorize a %s contract by providing an entry", (scope) => {
    expect(derive([entry()], { lineSources: { c1: { scope, origin: "reviewed", entryPolicy: "additive" } } }).manifest).toEqual([]);
  });
  it("marks a previously sent single as sent on a follow-up", () => {
    expect(derive([entry({ lineRule: "single", sentByRemovalId: "r2" })]).sentSingleComponentIds).toEqual(["c1"]);
  });
  it("refuses two value entries on one single line in a two-batch 200-year Removal", () => {
    const result = derive([entry({ lineRule: "single" }), entry({ id: "e2", creditBatchId: "b2", lineRule: "single" })], {
      memberBatchIds: ["b1", "b2"], contenders: [{ ...first, creditBatchIds: ["b1", "b2"] }],
      lineSources: { c1: { scope: "operating", entryPolicy: "single", origin: "reviewed" } },
    });
    expect(result.blockers[0].code).toBe("singleLineMultipleEntries");
    expect(result.inputs).toEqual([]);
  });
  it("preserves mass and distance detail beside the product", () => {
    const massDistanceDetail = { mass: { magnitude: "2", unit: "tonne" }, distance: { magnitude: "3", unit: "km" } };
    const result = derive([entry({ values: [{ inputKey: "mass_distance", magnitude: "6", unit: "km * tonne", massDistanceDetail }] })],
      { monitoredInputs: [{ componentId: "c1", inputKey: "mass_distance", unit: "km * tonne" }] });
    expect(result.manifest[0].entries[0].massDistanceDetail).toEqual(massDistanceDetail);
  });
  it("hashes content revision and evidence even when the numeric total stays the same", () => {
    const payload = (revision: number) => ({ templateSemanticFingerprint: "fp", entryContributions: derive([entry({ contentRevision: revision })]).manifest });
    expect(payloadHash(payload(1))).not.toBe(payloadHash(payload(2)));
    expect(reviewPayloadHash(payload(1))).not.toBe(reviewPayloadHash(payload(2)));
    expect(payloadHash(payload(1))).not.toBe(payloadHash({ ...payload(1), templateSemanticFingerprint: "changed" }));
  });
});

it("distinguishes live and retained reservations from transferable abandoned attempts", () => {
  const now = Date.now();
  expect(isLiveEntryReservation({ status: "draft", lockedAt: new Date(now), metadata: null }, now)).toBe(true);
  expect(isLiveEntryReservation({ status: "draft", lockedAt: null, metadata: null }, now)).toBe(false);
  expect(isLiveEntryReservation({ status: "rejected", lockedAt: null, metadata: { externalMutation: "possible" } }, now)).toBe(true);
  expect(isLiveEntryReservation({ status: "superseded", lockedAt: null, metadata: null }, now)).toBe(false);
  expect(removalEntryOwner(entry({ sendReservedBySubmissionId: "expired", reservationKnownInactive: true }), [first])).toBe("r1");
  expect(removalEntryOwner(entry({ sendReservedBySubmissionId: "unknown" }), [first])).toBeNull();
});
it("does not put an orphan blocker ahead of a none or forbidden contract", () => {
  for (const contract of [{ scope: "operating", entryPolicy: "none" }, { scope: "forbidden", entryPolicy: "none" }] as const) {
    expect(derive([entry({ occurredOn: "2026-03-02" })], { lineSources: { c1: { ...contract, origin: "reviewed" } } }).blockers).toEqual([]);
  }
});
it("retains every owned single entry for line review even though it cannot compile the group", () => {
  const result = derive([entry({ lineRule: "single" }), entry({ id: "e2", lineRule: "single", creditBatchId: "b2" })], {
    memberBatchIds: ["b1", "b2"], contenders: [{ ...first, creditBatchIds: ["b1", "b2"] }],
    lineSources: { c1: { scope: "operating", entryPolicy: "single", origin: "reviewed" } },
  });
  expect(result.ownedEntryIds).toEqual(["e1", "e2"]);
  expect(result.selectedEntryIds).toEqual([]);
  expect(result.blockers[0]).toMatchObject({ code: "singleLineMultipleEntries", lineRef: { componentId: "c1" } });
});
it("retains owned stale entries on removed template lines for review", () => {
  const result = derive([entry({ counts: false })], { lineSources: {} });
  expect(result.ownedEntryIds).toEqual(["e1"]);
  expect(result.entrySet).toEqual([]);
});

it.each(["additive", "single"] as const)("never sums separate transport inputs with a %s contract", (entryPolicy) => {
  const entries = [entry({ values: [{ inputKey: "mass", magnitude: "10", unit: "t" }, { inputKey: "distance", magnitude: "100", unit: "km" }] }),
    entry({ id: "e2", values: [{ inputKey: "mass", magnitude: "20", unit: "t" }, { inputKey: "distance", magnitude: "50", unit: "km" }] })];
  const result = derive(entries, { lineSources: { c1: { scope: "operating", origin: "reviewed", entryPolicy } },
    monitoredInputs: [{ componentId: "c1", inputKey: "mass", unit: "t" }, { componentId: "c1", inputKey: "distance", unit: "km" }] });
  expect(result.inputs).toEqual([]);
  expect(result.selectedEntryIds).toEqual([]);
  expect(result.blockers.map((row) => row.code)).toContain(entryPolicy === "additive" ? "lineNeedsReview" : "singleLineMultipleEntries");
});

it("holds an unsent replacement before drafts, including after the window closes", () => {
  const held = entry({ heldForRemovalId: "r2" });
  expect(removalEntryOwner(held, [first])).toBe("r2");
  expect(removalEntryOwner(held, [])).toBe("r2");
  expect(derive([held]).selectedEntryIds).toEqual([]);
  expect(derive([held], { removalId: "r2", contenders: [] }).entrySet).toEqual([{ entryId: held.id, contentRevision: 1 }]);
  expect(entriesWithoutRemoval([held], [], new Set(), [])).toEqual([]);
  expect(removalEntryOwner({ ...held, deletedAt: new Date() }, [])).toBeNull();
  expect(removalEntryOwner({ ...held, sentByRemovalId: "sent" }, [])).toBe("sent");
  expect(removalEntryOwner({ ...held, reservedByRemovalId: "reserved" }, [])).toBe("reserved");
  expect(removalEntryOwner({ ...held, sendReservedBySubmissionId: "unknown" }, [])).toBeNull();
});

it("omits another Removal's held single and keeps its follow-up batch line filled", () => {
  const held = entry({ lineRule: "single", heldForRemovalId: "r2" });
  const lineSources = { c1: { scope: "operating" as const, entryPolicy: "single" as const, origin: "reviewed" as const } };
  const contributions = derive([held], { lineSources });
  expect(contributions.sentSingleComponentIds).toEqual(["c1"]);
  expect(contributions.entrySet).toEqual([]);
  const lines = deriveRemovalBatchEmissionLines({
    definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "Group", description: "", components: [{
      id: "c1", displayName: "Electricity", description: null, blueprintKey: "metered_energy_based_ci_emissions",
      inputs: [{ key: "initial_readout", type: "monitored", quantityKind: "energy" }, { key: "final_readout", type: "monitored", quantityKind: "energy" }],
    }] }] },
    lineSources, problems: [], enrichmentComplete: true, automaticFigures: {}, entries: [], entriesCanSubmit: true,
  }, "b1", { entries: [held] }, contributions);
  expect(lines[0]).toMatchObject({ state: "filled", blocker: undefined });
  expect(held.sentByRemovalId).toBeNull();
});
