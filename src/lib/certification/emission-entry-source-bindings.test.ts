import { expect, it } from "vitest";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { SafeError } from "@/lib/errors";
import { emissionEntrySourceCandidates } from "./emission-entry-source-bindings";
import type { RemovalEntryContributions } from "./removal-emission-contributions";
import { buildRemovalSourceBindingPlan, buildRemovalSourceDescription, sourceIdsForDatapointTarget } from "./removal-source-bindings";
import { readRemovalCandidateSources, readRemovalSourceBindingPlan } from "@/fn/certification/removal-snapshot-readers";

const contributions: RemovalEntryContributions = {
  manifest: ["concentration", "flow"].map((inputKey) => ({ componentId: "paired", inputKey,
    entries: [{ entryId: "entry", contentRevision: 2, creditBatchId: "batch", kind: "value",
      value: { magnitude: "1", unit: "kg" }, evidenceDocumentIds: ["document"] }] })),
  entrySet: [{ entryId: "entry", contentRevision: 2 }], inputs: [], selectedEntryIds: ["entry"], sentSingleComponentIds: [], blockers: [],
};
const template = { groups: [{ key: "operating", components: ["paired", "unrelated"].map((id) => ({
  id, blueprint_key: "same-blueprint", inputs: ["concentration", "flow"].map((input_key) => ({ input_key, type: "monitored" })),
})) }] } as unknown as IsometricGhgEntryTemplate;
const candidates = () => emissionEntrySourceCandidates(contributions).map((candidate) => ({ ...candidate, sourceId: "source-entry" }));
const plan = (overrides: Partial<Parameters<typeof buildRemovalSourceBindingPlan>[0]> = {}) => buildRemovalSourceBindingPlan({
  candidates: candidates(), template, entryContributions: contributions, applicationIdsByCreditBatchId: new Map(), ...overrides,
});

it("binds the file to every contributed input on exactly its component", () => {
  expect(plan().map((entry) => [entry.documentId, entry.intendedTarget.componentId, entry.intendedTarget.inputKey]))
    .toEqual([["document", "paired", "concentration"], ["document", "paired", "flow"]]);
  expect(buildRemovalSourceDescription(candidates()[0].binding)).toBe("Noma role: Emissions entry. Lineage: Emissions entry entry.");
});
it.each(["component", "input", "entry", "document", "revision", "frozen"])("fails closed for an invalid %s", (invalid) => {
  const altered = candidates();
  if (invalid === "component") altered[0].binding.intendedTarget = { kind: "explicit", componentId: "absent", inputKey: "flow" };
  if (invalid === "input") altered[0].binding.intendedTarget = { kind: "explicit", componentId: "paired", inputKey: "absent" };
  if (invalid === "entry") altered[0].binding.lineage.entityId = "not-sent";
  if (invalid === "document") altered[0].documentId = "not-in-manifest";
  const entryContributions = structuredClone(contributions);
  if (invalid === "revision") entryContributions.entrySet[0].contentRevision++;
  if (invalid === "frozen") entryContributions.entrySet = [];
  expect(() => plan({ candidates: altered, entryContributions })).toThrow(SafeError);
});
it("rejects a target present in the template but absent from the entry's contributions", () => {
  const altered = candidates();
  altered[0].binding.intendedTarget = { kind: "explicit", componentId: "unrelated", inputKey: "flow" };
  expect(() => plan({ candidates: altered })).toThrow(/expected exactly one/);
});
it("zeros and absent (including tombstoned) entries create no candidates", () => {
  const zeros = structuredClone(contributions);
  zeros.manifest.forEach((input) => input.entries.forEach((entry) => { entry.kind = "zero"; entry.evidenceDocumentIds = []; }));
  expect(emissionEntrySourceCandidates(zeros)).toEqual([]);
  expect(emissionEntrySourceCandidates({ manifest: [], entrySet: [] })).toEqual([]);
});
it("unions, sorts and deduplicates automatic and entry source IDs per datapoint", () => {
  const entries = plan();
  const automatic = { ...entries[0], sourceId: "automatic", nomaRole: "inventory" as const };
  expect(sourceIdsForDatapointTarget([...entries, automatic, automatic], { componentId: "paired", inputKey: "concentration" }))
    .toEqual(["automatic", "source-entry"]);
  expect(sourceIdsForDatapointTarget(entries, { componentId: "unrelated", inputKey: "concentration" })).toEqual([]);
});
it("round-trips explicit candidate targets and the resolved role through snapshot readers", () => {
  const candidateSources = emissionEntrySourceCandidates(contributions);
  const sourceBindingPlan = plan();
  const row = { payloadSnapshot: { semantic: { candidateSources }, sourceBindingPlan } } as never;
  expect(readRemovalCandidateSources(row)).toEqual(candidateSources);
  expect(readRemovalSourceBindingPlan(row)).toEqual(sourceBindingPlan);
});
