import { describe, expect, it } from "vitest";
import { deriveRemovalSemanticCorrection } from "./removal-semantic-correction";

const sent = {
  inputs: [{ rtcId: "energy", inputKey: "electricity_use", kind: "monitored", value: 10, unit: "kWh" }],
  sequestrationTemplate: [{ rtcId: "storage", inputs: [{ inputKey: "carbon_content" }] }],
  startedOn: "2026-06-01T00:00:00Z", completedOn: "2026-06-30T00:00:00Z",
  sourceProductionRunIds: ["run"], sourceIds: ["source"],
  candidateSources: [{ documentId: "file", binding: { lineage: { entityId: "run", entityLabel: "Run PR-1" } } }],
  biocharApplicationIntents: [{ applicationId: "application", applicationCode: "A-1", fieldSizeHa: 1 }],
  durabilityMeasurementSamples: [{ sampleId: "sample", label: "Sample S-1", body: { values: [80] } }],
};
const derive = (current: Record<string, unknown> | null, windowOpen = true) => deriveRemovalSemanticCorrection({
  windowOpen, previous: sent, current, previousEntries: [], currentEntries: [],
  componentIds: ["energy", "storage"], batchIds: ["batch"],
});

describe("Removal semantic corrections", () => {
  it("attributes a lineage-only monitored value change to its component", () => {
    const state = derive({ ...sent, inputs: [{ ...sent.inputs[0], value: 11 }] });
    expect(state).toMatchObject({ correctionNeeded: true, changedComponentIds: ["energy"],
      changedPairs: [{ componentId: "energy", batchId: "batch" }],
      message: "Resubmit needed: 1 component changed since this Removal was sent." });
  });
  it("ignores free fields and display labels at every snapshot depth", () => {
    expect(derive({ ...sent, notes: "a note", code: "R-2",
      candidateSources: [{ ...sent.candidateSources[0], binding: { lineage: { entityId: "run", entityLabel: "Run PR-2" } } }],
      biocharApplicationIntents: [{ ...sent.biocharApplicationIntents[0], applicationCode: "A-2" }],
      durabilityMeasurementSamples: [{ ...sent.durabilityMeasurementSamples[0], label: "Sample S-2" }],
    }).correctionNeeded).toBe(false);
  });
  it("counts shared evidence additions against the actual components once", () => {
    expect(derive({ ...sent, candidateSources: [...sent.candidateSources, { documentId: "added", binding: null }] }))
      .toMatchObject({ correctionNeeded: true, changedComponentIds: ["energy", "storage"],
        message: "Resubmit needed: 2 components changed since this Removal was sent." });
  });
  it("counts the reporting window as a shared fact", () => {
    expect(derive({ ...sent, completedOn: "2026-07-01T00:00:00Z" }).changedComponentIds).toEqual(["energy", "storage"]);
  });
  it("attributes changed chemistry to sequestration", () => {
    expect(derive({ ...sent, durabilityMeasurementSamples: [{ ...sent.durabilityMeasurementSamples[0], body: { values: [81] } }] }))
      .toMatchObject({ changedComponentIds: ["storage"], changedBatchIds: ["batch"] });
  });
  it("compares the source binding target as well as the document set", () => {
    const previous = { ...sent, sourceBindingPlan: [{ documentId: "file", intendedTarget: { componentId: "energy", inputKey: "electricity_use" } }] };
    expect(deriveRemovalSemanticCorrection({ windowOpen: true, previous, current: { ...previous, sourceBindingPlan: [] },
      previousEntries: [], currentEntries: [], componentIds: ["energy", "storage"], batchIds: ["batch"] }).changedComponentIds).toEqual(["energy"]);
  });
  it("treats invalid current compilation as needing correction", () => {
    expect(derive(null).correctionNeeded).toBe(true);
  });
  it("does nothing outside an open correction window", () => {
    expect(derive(null, false)).toMatchObject({ windowOpen: false, correctionNeeded: false, changedComponentIds: [], message: null });
  });
  it("does not flag reordering", () => {
    expect(derive({ ...sent, candidateSources: [...sent.candidateSources].reverse() }).correctionNeeded).toBe(false);
  });
});

it("retains exact entry component and batch attribution when compiled quantities and entry files change", () => {
  const entry = { entryId: "entry", creditBatchId: "changed-batch", contentRevision: 1, kind: "value" as const,
    value: { magnitude: "2", unit: "kWh" }, evidenceDocumentIds: [] as string[] };
  const state = deriveRemovalSemanticCorrection({ windowOpen: true,
    previous: sent,
    current: { ...sent, inputs: [{ ...sent.inputs[0], value: 11 }], sourceIds: [...sent.sourceIds, "entry-source"],
      candidateSources: [...sent.candidateSources, { documentId: "entry-file", binding: { nomaRole: "emission_entry" } }],
      sourceBindingPlan: [{ documentId: "entry-file", sourceId: "entry-source", nomaRole: "emission_entry", intendedTarget: { componentId: "energy", inputKey: "electricity_use" } }],
    },
    previousEntries: [{ componentId: "energy", inputKey: "electricity_use", entries: [entry] }],
    currentEntries: [{ componentId: "energy", inputKey: "electricity_use", entries: [{ ...entry, contentRevision: 2,
      value: { magnitude: "3", unit: "kWh" }, evidenceDocumentIds: ["entry-file"] }] }],
    componentIds: ["energy", "storage"], batchIds: ["changed-batch", "unchanged-batch"],
  });
  expect(state.changedComponentIds).toEqual(["energy"]);
  expect(state.changedPairs).toEqual([{ componentId: "energy", batchId: "changed-batch" }]);
});
