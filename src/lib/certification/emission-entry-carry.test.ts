import { describe, expect, it } from "vitest";
import { removalEntryCarryOwner, type CarryContender } from "./emission-entry-carry";
import { deriveRemovalEntryContributions, entriesWithoutRemoval, type RemovalEntryFact } from "./removal-emission-contributions";
import type { EntryObservation } from "./emission-entry-rules";
import { creditBatchApplicationMass, isCreditBatchFullyApplied, MIN_VISIBLE_NOT_APPLIED_DRY_KG } from "@/lib/credit-batches/application-mass";

const observation: EntryObservation = {
  externalTemplateId: "template", definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "Group", description: "",
    components: [{ id: "line", displayName: "Electricity", description: null, blueprintKey: "grid_electricity_use",
      inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] }] }] },
  enrichment: { line: { electricity_use: { unit: "kWh" } } },
  lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
};
const entry: RemovalEntryFact = { id: "entry", creditBatchId: "origin", componentId: "line", contentRevision: 1,
  kind: "value", lineRule: "additive", occurredOn: "2026-09-14", deletedAt: null, sentByRemovalId: null,
  confirmedForRemovalId: null, sendReservedBySubmissionId: null, counts: true,
  values: [{ inputKey: "electricity_use", magnitude: "120", unit: "kWh" }], evidenceDocumentIds: ["file"] };
const draft: CarryContender = { contenderKind: "draft", removalId: "receiver", code: "RM-010", organizationId: "org", facilityId: "facility",
  createdAt: "2026-10-01", creditBatchIds: ["next"], creditBatchCodes: ["CB-010"], window: { start: "2026-09-16", end: "2026-10-03" }, observation };
function decide(overrides: Partial<Parameters<typeof removalEntryCarryOwner>[0]> = {}) {
  return removalEntryCarryOwner({ entry, organizationId: "org", facilityId: "facility", fullyApplied: true,
    ownContenders: [], contenders: [draft], observation, ...overrides });
}
describe("late manual entry ownership", () => {
  it("uses ends-after even when the entry predates the receiving start", () => {
    expect(decide().receiver?.removalId).toBe("receiver");
    expect(decide({ contenders: [{ ...draft, window: { ...draft.window, end: entry.occurredOn } }] }).receiver).not.toBeNull();
    expect(decide({ contenders: [{ ...draft, window: { start: "2026-09-01", end: "2026-09-13" } }] }).waitingReason).toBe("noDraft");
  });
  it("keeps unknown mass closed and derives remaining mass from application slices", () => {
    const runs = [{ biocharDryMassKg: 285 }];
    expect(creditBatchApplicationMass(runs, [{ dryKg: 284.999 }]).notAppliedDryKg).toBe(0.001);
    expect(creditBatchApplicationMass(runs, [{ dryKg: 285 }]).notAppliedDryKg).toBe(0);
    expect(creditBatchApplicationMass([{ biocharDryMassKg: null }], []).notAppliedDryKg).toBeNull();
    expect(creditBatchApplicationMass([], []).notAppliedDryKg).toBeNull();
    expect(decide({ fullyApplied: false })).toEqual({ receiver: null, waitingReason: null });
    expect(entriesWithoutRemoval([entry], [], new Set(), [])).toEqual([entry.id]);
  });
  it("leaves an entry with its own eligible Removal", () => {
    expect(decide({ ownContenders: [{ ...draft, creditBatchIds: ["origin"], window: { start: "2026-09-01", end: "2026-09-15" } }] }).receiver).toBeNull();
  });
  it("skips incompatible templates and gives a specific waiting reason", () => {
    const incompatible = { ...draft, observation: { ...observation, externalTemplateId: "different" } };
    expect(decide({ contenders: [incompatible] }).waitingReason).toBe("incompatibleTemplate");
    expect(decide({ contenders: [incompatible, { ...draft, removalId: "later", window: { ...draft.window, end: "2026-11-01" } }] }).receiver?.removalId).toBe("later");
    expect(decide({ contenders: [] }).waitingReason).toBe("noDraft");
  });
  it.each<Partial<RemovalEntryFact>>([
    { kind: "zero" }, { lineRule: "single" }, { deletedAt: new Date() },
    { sentByRemovalId: "sent" }, { heldForRemovalId: "held" },
    { sendReservedBySubmissionId: "attempt", reservedByRemovalId: "reserved" },
    { sendReservedBySubmissionId: "unknown" },
    { values: [entry.values[0], { ...entry.values[0], inputKey: "other" }] },
  ])("never moves a held, sent, zero, single, deleted or paired entry (%j)", change => {
    expect(decide({ entry: { ...entry, ...change } }).receiver).toBeNull();
  });
  it("carries a single mass-distance input including its entered detail, but refuses a paired origin", () => {
    const transport = structuredClone(observation);
    Object.assign(transport.definition.groups[0].components[0], { blueprintKey: "mass_distance_based_ci_emissions",
      inputs: [{ key: "mass_distance", type: "monitored", quantityKind: "mass_distance" }] });
    transport.enrichment = { line: { mass_distance: { unit: "tonne * km" } } };
    const value = { inputKey: "mass_distance", magnitude: "6", unit: "km * tonne", massDistanceDetail: {
      mass: { magnitude: "2", unit: "tonne" }, distance: { magnitude: "3", unit: "km" },
    } };
    expect(decide({ entry: { ...entry, values: [value] }, observation: transport,
      contenders: [{ ...draft, observation: transport }] }).receiver?.removalId).toBe(draft.removalId);
    transport.definition.groups[0].components[0].inputs.push({ key: "mass", type: "monitored", quantityKind: "mass" });
    expect(decide({ entry: { ...entry, values: [value] }, observation: transport }).receiver).toBeNull();
  });
  it("waits at an unread template before a later compatible draft", () => {
    const unread = { ...draft, observation: null };
    expect(decide({ contenders: [unread] }).waitingReason).toBe("templateUnknown");
    expect(decide({ contenders: [unread] }).waitingFor).toEqual({ removalId: draft.removalId, removalCode: draft.code });
    expect(decide({ contenders: [{ ...draft, removalId: "later", window: { ...draft.window, end: "2026-11-01" } }, unread] })).toEqual({
      receiver: null, waitingReason: "templateUnknown", waitingFor: { removalId: draft.removalId, removalCode: draft.code },
    });
  });
  it("refuses paired receiving components", () => {
    const paired = structuredClone(observation);
    paired.definition.groups[0].components[0].inputs.push({ key: "second", type: "monitored", quantityKind: "mass" });
    expect(decide({ contenders: [{ ...draft, observation: paired }] }).receiver).toBeNull();
  });
  it("excludes other organizations, facilities and correction Removals", () => {
    for (const change of [{ organizationId: "other" }, { facilityId: "other" }, { contenderKind: "correction" as const }]) {
      expect(decide({ contenders: [{ ...draft, ...change }] }).receiver).toBeNull();
    }
  });
  it("orders by end, creation and id", () => {
    const a = { ...draft, removalId: "a" };
    expect(decide({ contenders: [draft, a] }).receiver?.removalId).toBe("a");
    expect(decide({ contenders: [a, { ...draft, createdAt: "2026-09-01" }] }).receiver?.removalId).toBe("receiver");
    expect(decide({ contenders: [a, { ...draft, window: { start: "2026-09-01", end: "2026-09-15" } }] }).receiver?.removalId).toBe("receiver");
  });
  it("adds carried values without consuming the receiving batch's zero", () => {
    const carry = decide();
    const result = deriveRemovalEntryContributions({ removalId: draft.removalId, memberBatchIds: ["next"], window: draft.window,
      contenders: [draft], entries: [{ ...entry, carry }, { ...entry, id: "zero", creditBatchId: "next", occurredOn: draft.window.start, kind: "zero", values: [], confirmedForRemovalId: draft.removalId }],
      lineSources: observation.lineSources, monitoredInputs: [{ componentId: "line", inputKey: "electricity_use", unit: "kWh" }] });
    expect(result.selectedEntryIds).toEqual(["entry", "zero"]);
    expect(result.inputs[0].value.magnitude).toBe("120");
    expect(entriesWithoutRemoval([{ ...entry, carry }], [], new Set(), [])).toEqual([]);
    expect(entriesWithoutRemoval([{ ...entry, carry: decide({ contenders: [] }) }], [], new Set(), [])).toEqual([]);
  });
  it("keeps a reservation on its receiver when an earlier draft appears", () => {
    const reserved = { ...entry, reservedByRemovalId: draft.removalId, sendReservedBySubmissionId: "attempt" };
    const result = deriveRemovalEntryContributions({ removalId: draft.removalId, memberBatchIds: ["next"], window: draft.window,
      contenders: [{ ...draft, removalId: "earlier", creditBatchIds: ["origin"], window: { start: "2026-09-01", end: "2026-09-15" } }], entries: [reserved],
      lineSources: observation.lineSources, monitoredInputs: [{ componentId: "line", inputKey: "electricity_use", unit: "kWh" }] });
    expect(result.selectedEntryIds).toEqual([entry.id]);
  });
});


it("gives an own-batch correction priority over carry, only inside its window", () => {
  const own: CarryContender = { ...draft, contenderKind: "correction", removalId: "origin-removal",
    creditBatchIds: [entry.creditBatchId], window: { start: "2026-09-01", end: "2026-09-15" } };
  expect(decide({ ownContenders: [own] })).toEqual({ receiver: null, waitingReason: null });
  expect(decide({ ownContenders: [{ ...own, window: { ...own.window, end: "2026-09-13" } }] }).receiver?.removalId).toBe(draft.removalId);
});


it.each([0, MIN_VISIBLE_NOT_APPLIED_DRY_KG - 0.001, MIN_VISIBLE_NOT_APPLIED_DRY_KG, MIN_VISIBLE_NOT_APPLIED_DRY_KG + 0.001, null])(
  "uses the shared remaining-stock threshold for %s dry kg", remaining => {
    const fullyApplied = isCreditBatchFullyApplied(remaining);
    expect(fullyApplied).toBe(remaining !== null && remaining < MIN_VISIBLE_NOT_APPLIED_DRY_KG);
    expect(decide({ fullyApplied }).receiver?.removalId ?? null).toBe(fullyApplied ? draft.removalId : null);
  },
);

it("skips a known incompatible draft then waits for the first unread draft", () => {
  const incompatible = { ...draft, observation: { ...observation, externalTemplateId: "different" } };
  const unread = { ...draft, removalId: "unread", code: "RM-unread", observation: null, window: { ...draft.window, end: "2026-10-04" } };
  const later = { ...draft, removalId: "later", window: { ...draft.window, end: "2026-11-01" } };
  expect(decide({ contenders: [later, unread, incompatible] })).toEqual({
    receiver: null, waitingReason: "templateUnknown", waitingFor: { removalId: unread.removalId, removalCode: unread.code },
  });
});
