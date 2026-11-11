import { EMISSION_LINE_FILE_CHANGED, LINE_FILE_MISSING_INSTRUCTION } from "@/lib/certification/emission-entry-messages";
import { projectEvidenceTargets, projectDurabilityLedgerInputKeys } from "@/lib/isometric/semantic-binding-projections";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import { expect, it } from "vitest";
import { lineFileEvidenceFacts } from "../../../tests/helpers/line-file-evidence-facts";
import { deriveLineFileEvidence, lineFileSourceCandidates } from "./emission-line-file-evidence";
import { buildRemovalSourceBindingPlan, sourceIdsForDatapointTarget, SOURCE_BINDING_MAPPING_REVISION } from "./removal-source-bindings";
import { deriveRemovalBatchEmissionLines, omittedProductionSources } from "./removal-emission-lines";
import { deriveRemovalSemanticCorrection } from "./removal-semantic-correction";
import { filterCandidateSourcesForSubmissionLifecycle } from "./removal-source-freeze";
import { buildBatchEmissionLines } from "@/lib/read-models/batches-emission-lines";

it.each([false, true])("binds the exact From records input (fuel=%s)", fuel => {
  const { template, observation, batch, inputKey } = lineFileEvidenceFacts(fuel);
  const lineFileEvidence = deriveLineFileEvidence({ batch }, observation);
  const candidates = lineFileSourceCandidates(lineFileEvidence).map(candidate => ({ ...candidate, sourceId: "source" }));
  const plan = buildRemovalSourceBindingPlan({ candidates, template, lineFileEvidence, applicationIdsByCreditBatchId: new Map() });
  expect(plan).toHaveLength(1);
  expect(plan[0]).toMatchObject({ documentId: "document", nomaRole: "emission_line_file", lineFile: { anchorVersion: 2 },
    intendedTarget: { componentId: "component", inputKey } });
  expect(sourceIdsForDatapointTarget(plan, { componentId: "component", inputKey })).toEqual(["source"]);
  expect(sourceIdsForDatapointTarget(plan, { componentId: "other", inputKey })).toEqual([]);
  expect(sourceIdsForDatapointTarget(plan, { componentId: "component", inputKey: "other" })).toEqual([]);
  expect(() => buildRemovalSourceBindingPlan({ candidates, template, lineFileEvidence: [], applicationIdsByCreditBatchId: new Map() })).toThrow(EMISSION_LINE_FILE_CHANGED);
});

it.each([
  { total: "0.000", hasFile: false, policy: "lineFile", otherClaim: false, missing: false },
  { total: "0.5", hasFile: false, policy: "lineFile", otherClaim: false, missing: true },
  { total: "0.5", hasFile: true, policy: "lineFile", otherClaim: false, missing: false },
  { total: "0.5", hasFile: false, policy: "none", otherClaim: false, missing: false },
  { total: "0.5", hasFile: false, policy: "lineFile", otherClaim: true, missing: false },
] as const)("derives the shared file blocker: %j", ({ total, hasFile, policy, otherClaim, missing }) => {
  const { observation, batch, source } = lineFileEvidenceFacts();
  batch.automaticFigures[source]!.magnitude = total;
  if (!hasFile) batch.lineFiles = [];
  observation.lineSources.component.filePolicy = policy;
  batch.omittedAutomaticSources = omittedProductionSources(otherClaim ? "other" : null, "removal");
  const [line] = deriveRemovalBatchEmissionLines({ ...batch, ...observation, problems: [], enrichmentComplete: true, entriesCanSubmit: true }, "batch");
  expect(line.blocker?.code).toBe(missing ? "lineMissingEvidence" : undefined);
  if (missing) expect(line).toMatchObject({ state: "missingEvidence", blocker: { creditBatchId: "batch", fixTarget: "emissions",
    message: LINE_FILE_MISSING_INSTRUCTION, lineRef: { componentId: "component" } } });
  const evidence = deriveLineFileEvidence({ batch }, observation);
  expect(evidence).toHaveLength(hasFile && !otherClaim && policy === "lineFile" ? 1 : 0);
});

it.each(["0", "0.000", "-0"])("sends no Source for exact zero %s even with a file", total => {
  const { batch, observation, source, template } = lineFileEvidenceFacts();
  batch.automaticFigures[source]!.magnitude = total;
  const lineFileEvidence = deriveLineFileEvidence({ batch }, observation);
  expect(buildRemovalSourceBindingPlan({ template, lineFileEvidence,
    candidates: lineFileSourceCandidates(lineFileEvidence).map(candidate => ({ ...candidate, sourceId: "source" })),
    applicationIdsByCreditBatchId: new Map(),
  })).toEqual([]);
});

it("excludes an uploaded file when another Removal claims production", () => {
  const { batch, observation } = lineFileEvidenceFacts();
  batch.omittedAutomaticSources = omittedProductionSources("other", "removal");
  expect(lineFileSourceCandidates(deriveLineFileEvidence({ batch }, observation))).toEqual([]);
});

it("attaches the stored file and its requirement to the read model", () => {
  const { batch, observation } = lineFileEvidenceFacts();
  const build = () => buildBatchEmissionLines(observation, [], new Map(), batch, [], batch.lineFiles)[0];
  expect(build().lineFile).toEqual({ anchorId: "anchor", documents: [{ id: "document", fileName: "proof.pdf", version: 1 }], needsFile: true, policy: "lineFile" });
  batch.lineFiles = [{ ...batch.lineFiles![0], documents: [] }];
  expect(build()).toMatchObject({ state: "missingEvidence", lineFile: { anchorId: "anchor", documents: [], needsFile: true } });
  batch.automaticFigures["run-electricity"]!.magnitude = "0.000";
  expect(build()).toMatchObject({ state: "filled", lineFile: { needsFile: false } });
});

it("detects a replacement and uses live component files in the returned window", () => {
  const { batch, observation, template } = lineFileEvidenceFacts();
  const semantic = () => {
    const lineFileEvidence = deriveLineFileEvidence({ batch }, observation);
    const candidateSources = lineFileSourceCandidates(lineFileEvidence);
    const sourceBindingPlan = buildRemovalSourceBindingPlan({ template, lineFileEvidence,
      candidates: candidateSources.map(candidate => ({ ...candidate, sourceId: candidate.documentId })), applicationIdsByCreditBatchId: new Map() });
    return { candidateSources, sourceBindingPlan, sourceIds: candidateSources.map(candidate => candidate.documentId) };
  };
  const previous = semantic();
  batch.lineFiles![0].anchor.version++;
  batch.lineFiles![0].documents[0].id = "replacement";
  const current = semantic();
  expect(deriveRemovalSemanticCorrection({ previous, current, windowOpen: true, previousEntries: [], currentEntries: [], componentIds: ["component"], batchIds: ["batch"] }))
    .toMatchObject({ correctionNeeded: true, changedComponentIds: ["component"], changedBatchIds: ["batch"] });
  expect(filterCandidateSourcesForSubmissionLifecycle(current.candidateSources, null, true)).toEqual(current.candidateSources);
});

it("changes the previous binding mapping revision", () => {
  const targets = projectEvidenceTargets();
  const roles = [
    ["labReport", "lab_report", "Sample lab report"], ["inventory", "inventory", "Inventory"],
    ["feedstockBillOfLading", "feedstock_bill_of_lading", "Feedstock bill of lading"],
    ["deliveryBillOfLading", "delivery_bill_of_lading", "Delivery bill of lading"],
    ["transportEvidenceLedger", "transport_evidence_ledger", "Transport evidence ledger"],
  ] as const;
  const rules = Object.fromEntries(roles.map(([key, nomaRole, nomaRoleLabel]) => {
    const [intendedTarget, ...additionalIntendedTargets] = targets[nomaRole]!;
    return [key, { nomaRole, nomaRoleLabel, intendedTarget, ...(additionalIntendedTargets.length ? { additionalIntendedTargets } : {}) }];
  }));
  const previous = { rules, durabilityLedgerTargets: projectDurabilityLedgerInputKeys(), materializationRevision: 5,
    explicitEntryRole: { role: "emission_entry", targetKeys: ["componentId", "inputKey"] } };
  expect(SOURCE_BINDING_MAPPING_REVISION).not.toBe(payloadHash(previous));
  expect(SOURCE_BINDING_MAPPING_REVISION).toBe(payloadHash({ ...previous, materializationRevision: 6,
    explicitLineRole: { role: "emission_line_file", targetKeys: ["componentId", "inputKey"] } }));
});

it("keeps manual-entry proof separate from the From records file", () => {
  const { batch, observation } = lineFileEvidenceFacts();
  const entries = [{ componentId: "component", kind: "value" as const, counts: true, hasEvidence: false,
    total: { magnitude: "1", unit: "kWh" } }];
  const derive = () => deriveRemovalBatchEmissionLines({ ...batch, ...observation, entries,
    problems: [], enrichmentComplete: true }, "batch")[0];
  expect(derive().blocker?.code).toBe("entryMissingEvidence");
  entries[0].hasEvidence = true;
  batch.lineFiles = [];
  expect(derive().blocker?.code).toBe("lineMissingEvidence");
  batch.automaticFigures["run-electricity"]!.magnitude = "0";
  expect(derive().blocker).toBeUndefined();
});

it("binds both uploaded documents on one component to its exact input", () => {
  const { template, observation, batch, inputKey } = lineFileEvidenceFacts();
  batch.lineFiles![0].documents.push({ id: "second", fileName: "corrected.pdf", version: 1 });
  const lineFileEvidence = deriveLineFileEvidence({ batch }, observation);
  const candidates = lineFileSourceCandidates(lineFileEvidence).map(candidate => ({ ...candidate, sourceId: candidate.documentId }));
  const plan = buildRemovalSourceBindingPlan({ candidates, template, lineFileEvidence, applicationIdsByCreditBatchId: new Map() });
  expect(plan).toHaveLength(2);
  expect(sourceIdsForDatapointTarget(plan, { componentId: "component", inputKey })).toEqual(["document", "second"]);
  batch.lineFiles![0].anchor.version++;
  expect(() => buildRemovalSourceBindingPlan({ candidates, template,
    lineFileEvidence: deriveLineFileEvidence({ batch }, observation), applicationIdsByCreditBatchId: new Map(),
  })).toThrow(EMISSION_LINE_FILE_CHANGED);
});

it("suppresses locked batch proof without hiding the records figure or weakening Removal proof", () => {
  const { batch, observation } = lineFileEvidenceFacts();
  batch.lineFiles = [];
  batch.recordsFileLocked = true;
  const line = buildBatchEmissionLines(observation, [], new Map(), batch)[0];
  expect(line).toMatchObject({ state: "filled", records: { figure: { magnitude: "0.5", unit: "kWh" } },
    lineFile: { documents: [], needsFile: false } });
  expect(line.blocker).toBeUndefined();
  const [claimingLine] = deriveRemovalBatchEmissionLines({ ...batch, ...observation, recordsFileLocked: false,
    problems: [], enrichmentComplete: true }, "batch");
  expect(claimingLine.blocker?.code).toBe("lineMissingEvidence");
});
