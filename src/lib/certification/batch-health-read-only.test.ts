import { describe, expect, it } from "vitest";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { buildDurabilityBatchGates } from "@/fn/certification/durability-readiness";
import { buildSubmissionLineageBlockers } from "@/fn/certification/certify-lineage-blockers";
import { buildCreditBatchOpenItems, openItemText } from "@/lib/credit-batches/open-items";
import { readOnlyOpenItems } from "@/lib/credit-batches/batch-page";
import { buildSoilTemperatureGate } from "@/lib/isometric/utils/durability-aggregation";
import { deriveBatchHealth, type BatchHealthFacts } from "./batch-health";
import { toBatchHealthFacts } from "./batch-health-facts";
import { attributeSoilTemperatureBlockers } from "./member-batch-gates";
import { applicationDestinationMessage, durabilityConfigurationBlockerMessages } from "./submission-readiness";
import { removalTemplateBlocker } from "./removal-template-blockers";

const healthy: BatchHealthFacts = {
  carbonMissingInputs: [], facilityEmissionsBlockers: [], feedstockTypeMappingGaps: [],
  entityReadinessGaps: [], hasSubmittableRuns: true, facilitySetupComplete: true, requiredTransport: [],
};
const pageContext = { facilityId: "facility", creditBatchId: "batch-1", canManage: true };

function loadedFacts() {
  const batch = {
    creditBatchId: "batch-1", creditBatchCode: "CB-26-001", sampling: "sampled" as const,
    durabilityOption: "200_year" as const, samples: [], runs: [],
    startDate: "2026-02-01", endDate: "2026-02-28", facilityTimezone: "UTC",
  };
  const carbon = buildDurabilityBatchGates([batch]);
  const soil = buildSoilTemperatureGate({ facilityReference: null, batches: [{ durabilityOption: "200_year", runIds: [] }], siteTemperatures: [] });
  const configuration = durabilityConfigurationBlockerMessages([batch]);
  const members = attributeSoilTemperatureBlockers([{
    id: batch.creditBatchId, code: batch.creditBatchCode,
    durabilityGateBlockers: carbon.blockersByBatchId[batch.creditBatchId],
    durabilityGateFacts: carbon.blockerFactsByBatchId[batch.creditBatchId],
  }], [batch], soil.blockers);
  return toBatchHealthFacts({
    memberBatches: members, mapping: {}, removalTemplate: {},
    unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], hasSubmittableRuns: true,
    requiredTransportCategories: [], entityReadinessGaps: [],
    submissionLineageBlockers: buildSubmissionLineageBlockers([], ["fs-1"], { "fs-1": "FS-1" }, ["feedstock"]),
    durabilityConfigurationBlockers: configuration.map((copy) => copy.message),
    durabilityConfigurationFacts: configuration.map((copy) => copy.fact),
  } as unknown as RemovalCertifyContext, batch.creditBatchId);
}

const checks = [
  { target: "labSamples", fact: "Credit batch CB-26-001 is marked as sampled but has no Samples.", detail: "Missing: Credit batch CB-26-001 is marked as sampled but has no Samples. Add at least 3 Samples before submitting." },
  { target: "feedstocks", fact: "Feedstock FS-1 has no usable transport leg.", detail: "Feedstock FS-1 has no usable transport leg. Record a positive distance and load mass before submitting." },
  { target: "batchDetails", fact: "200-year Removals cannot be submitted yet.", detail: "200-year Removals cannot be submitted yet. Wait for support to confirm registry availability." },
];

describe("read-only batch health facts", () => {
  it.each(checks)("preserves editable $target copy and shows only its fact read only", ({ target, fact, detail }) => {
    const health = deriveBatchHealth(loadedFacts());
    const check = health.checks.find((check) => check.fixTarget === target)!;
    expect(check.detail).toBe(detail);
    expect(check.readOnlyDetail).toBe(fact);
    const editable = buildCreditBatchOpenItems({ ...pageContext, health });
    const id = `health:${check.key}:${check.issueKey ?? check.fixTarget}`;
    const editableItem = editable.blocking.find((item) => item.id === id)!;
    expect(openItemText(editableItem)).toBe(detail);
    if (target === "feedstocks") {
      expect(editableItem.detail).toBe(fact);
      expect(editableItem.instruction).toBe("Record a positive distance and load mass before submitting.");
    }
    const item = readOnlyOpenItems({ ...editable, waiting: [] }).blocking.find((item) => item.id === id)!;
    expect(item.detail).toBe(fact);
    expect(item.instruction).toBeUndefined();
    expect(item.target).toEqual(target === "labSamples" ? { tab: "samples" } : null);
    expect(openItemText(editableItem)).toBe(detail);
  });

  it("joins multiple producer facts like merged check text, each once", () => {
    const configuration = durabilityConfigurationBlockerMessages([
      { sampling: "unsampled", durabilityOption: "200_year" },
    ]);
    const carbonFacts = [
      "Credit batch CB-1 has 1 Sample with complete H/C_org and O/C_org results.",
      "Credit batch CB-1 fails biochar eligibility (H/C_org mean 0.800 ≥ 0.5), under module §3 Table 2.",
    ];
    const carbonMessages = [`${carbonFacts[0]} Add complete results to at least 3 Samples before submitting.`, carbonFacts[1]];
    const health = deriveBatchHealth({ ...healthy, carbonMissingInputs: carbonMessages, carbonBlockerFacts: [...carbonFacts, carbonFacts[0]],
      durabilityConfigurationBlockers: configuration.map((copy) => copy.message),
      durabilityConfigurationFacts: configuration.map((copy) => copy.fact),
    });
    expect(health.checks.find((check) => check.key === "carbon")).toMatchObject({
      detail: `Missing: ${carbonMessages.join(", ")}`, readOnlyDetail: carbonFacts.join(" · "),
    });
    expect(health.checks.find((check) => check.fixTarget === "batchDetails")).toMatchObject({
      detail: configuration.map((copy) => copy.message).join(" · "),
      readOnlyDetail: "Unsampled Method B Removals cannot be submitted yet. · 200-year Removals cannot be submitted yet.",
    });
  });

  it.each([
    { secondOrderId: "order-1", fact: "Order OR-1 has no customer location." },
    { secondOrderId: "order-2", fact: "2 orders have no customer location." },
  ])("counts order destination facts without their repair steps: $fact", ({ secondOrderId, fact }) => {
    const first = applicationDestinationMessage("AP-1");
    const second = applicationDestinationMessage("AP-2");
    const health = deriveBatchHealth({ ...healthy, submissionLineageBlockers: [
      { kind: "applicationDestination", instruction: first.instruction!, detail: first.message, fact: first.fact, fixTarget: "orders", record: { id: "order-1", code: "OR-1" } },
      { kind: "applicationDestination", instruction: second.instruction!, detail: second.message, fact: second.fact, fixTarget: "orders", record: { id: secondOrderId, code: secondOrderId === "order-1" ? "OR-1" : "OR-2" } },
    ] });
    const unmet = health.checks.filter((check) => check.status === "unmet");
    expect(unmet).toHaveLength(1);
    const [check] = unmet;
    expect(check.fixTarget).toBe("orders");
    expect(check.issueKey).toBe("submission-orders");
    expect(check.detail).toBe(`${fact} ${first.instruction}`);
    expect(check.readOnlyDetail).toBe(fact);
    const [item] = readOnlyOpenItems({ ...buildCreditBatchOpenItems({ ...pageContext, health }), waiting: [] }).blocking;
    expect(item.detail).toBe(check.readOnlyDetail);
  });

  it.each([false, true])("states every merged fact or none, never a bare detail (copy: %s)", (hasCopy) => {
    const destination = applicationDestinationMessage("AP-1");
    const health = deriveBatchHealth({ ...healthy, hasSubmittableRuns: false,
      productionReadinessGap: { kind: "noApplications", fixTarget: "deliveries", detail: "Production is missing. Record it.",
        ...(hasCopy ? { copy: { detail: "Production is missing.", instruction: "Record it." } } : {}),
      },
      submissionLineageBlockers: [{ kind: "applicationDestination", instruction: destination.instruction!, detail: destination.message, fact: destination.fact, fixTarget: "deliveries", record: { id: "app-1", code: "AP-1" } }],
    });
    const unmet = health.checks.filter((check) => check.status === "unmet");
    expect(unmet).toHaveLength(1);
    const [check] = unmet;
    expect(check.fixTarget).toBe("deliveries");
    expect(check.readOnlyDetail).toBe(hasCopy ? `Production is missing. · ${destination.fact}` : undefined);
    expect(check.detail).toBe(`Production is missing. Record it. · ${destination.message}`);
    const [item] = readOnlyOpenItems({ ...buildCreditBatchOpenItems({ ...pageContext, health }), waiting: [] }).blocking;
    expect(item.detail).toBe(hasCopy ? check.readOnlyDetail : undefined);
  });

  it("states carbon facts with the Sample evidence count when both route to Samples", () => {
    const carbonFact = "Credit batch CB-1 is marked as sampled but has no Samples.";
    const health = deriveBatchHealth({ ...healthy,
      carbonMissingInputs: [`${carbonFact} Add at least 3 Samples before submitting.`], carbonBlockerFacts: [carbonFact],
      entityReadinessGaps: ["Sample S-1 moisture"],
      entityReadinessIssues: [{ key: "lab-samples", label: "Sample evidence", fixTarget: "labSamples",
        affectedRecords: [{ id: "sample-1", code: "S-1", missing: ["Moisture"] }] }],
    });
    const check = health.checks.find((check) => check.status === "unmet" && check.fixTarget === "labSamples")!;
    expect(check.issueKey).toContain("+");
    expect(check.readOnlyDetail).toBe(`${carbonFact} · 1 record needs attention`);
    const [item] = readOnlyOpenItems({ ...buildCreditBatchOpenItems({ ...pageContext, health }), waiting: [] }).blocking;
    expect(item.detail).toBe(check.readOnlyDetail);
  });

  it("merges missing feedstock transport coverage with its lineage fact", () => {
    const health = deriveBatchHealth({ ...healthy,
      requiredTransport: [{ category: "feedstock", present: false }],
      submissionLineageBlockers: buildSubmissionLineageBlockers([], ["fs-1"], { "fs-1": "FS-1" }, ["feedstock"]),
    });
    const check = health.checks.find((check) => check.status === "unmet" && check.fixTarget === "feedstocks")!;
    expect(check.detail).toBe("Missing feedstock transport legs · Feedstock FS-1 has no usable transport leg. Record a positive distance and load mass before submitting.");
    expect(check.readOnlyDetail).toBe("Missing feedstock transport legs · Feedstock FS-1 has no usable transport leg.");
  });

  it("shows only the soil temperature title, which states the fact", () => {
    const health = deriveBatchHealth(loadedFacts());
    const check = health.checks.find((check) => check.key === "facilityEmissions")!;
    const editable = buildCreditBatchOpenItems({ ...pageContext, health });
    const id = `health:${check.key}:${check.issueKey ?? check.fixTarget}`;
    expect(editable.blocking.find((item) => item.id === id)?.detail).toContain("Set this facility's reference soil temperature");
    const item = readOnlyOpenItems({ ...editable, waiting: [] }).blocking.find((item) => item.id === id)!;
    expect(item.title).toBe("No reference soil temperature for the facility");
    expect(item.detail).toBeUndefined();
  });

  it("keeps the unpinned fact when it merges with another template blocker", () => {
    const health = deriveBatchHealth({ ...healthy, templateBlockers: [removalTemplateBlocker("unpinnedTemplate"), removalTemplateBlocker("missingFixedDatapoint")] });
    const [item] = readOnlyOpenItems({ ...buildCreditBatchOpenItems({ ...pageContext, health }), waiting: [] }).blocking;
    expect(item.detail).toBe("This credit batch has no Removal template. · Some fixed values are not set in the Isometric template.");
  });

  it("shows only the unpinned template title on the read-only Overview", () => {
    const health = deriveBatchHealth({ ...healthy, templateBlockers: [removalTemplateBlocker("unpinnedTemplate")] });
    const editable = buildCreditBatchOpenItems({ ...pageContext, health });
    expect(openItemText(editable.blocking[0])).toBe("Set a Removal template in Settings, Removal templates.");
    const [item] = readOnlyOpenItems({ ...editable, waiting: [] }).blocking;
    expect(item.title).toBe("No Removal template chosen");
    expect(item.detail).toBeUndefined();
    expect(item.instruction).toBeUndefined();
  });
});
