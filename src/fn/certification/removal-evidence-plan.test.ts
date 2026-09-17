import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sources", () => ({
  collectCandidateSourceDocumentsForRemoval: vi.fn(),
  resolveSourceBindingCandidates: vi.fn(),
}));

import { classifyRemovalSourceCandidate } from "@/lib/certification/removal-source-bindings";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { BiocharApplicationIntent } from "./biochar-application-intents";
import type { RemovalSubmissionContext } from "./certify-context-core";
import { planRemovalEvidence } from "./removal-evidence-plan";
import * as sources from "./sources";

const ORG_CONTEXT = {
  userId: "removal-evidence-plan-user",
  organizationId: "removal-evidence-plan-org",
  orgRole: "owner",
  isPlatformAdmin: false,
} as const;

const template = {
  id: "rvt-safety-margin",
  display_name: "Safety margin template",
  groups: [
    {
      key: "co2-stored",
      components: [
        {
          id: "component-sequestration",
          blueprint_key: "carbon_rich_substance_sequestration",
          display_name: "Sequestered biochar",
          inputs: [
            {
              type: "monitored",
              input_key: "product_mass",
              datapoint_id: null,
              display_name: "Product mass",
              quantity_kind: "mass",
            },
          ],
        },
      ],
    },
    {
      key: "miscellaneous",
      components: [
        {
          id: "component-safety-margin",
          blueprint_key: "mass_based_ci_emissions",
          display_name: "Safety margin",
          inputs: [
            {
              type: "monitored",
              input_key: "mass",
              datapoint_id: null,
              display_name: "Mass",
              quantity_kind: "mass",
            },
          ],
        },
      ],
    },
  ],
} as unknown as IsometricGhgEntryTemplate;

const ctx = {
  lineages: [
    {
      application: { id: "application-1", code: "APP-001" },
      delivery: { id: "delivery-1" },
    },
  ],
  batchesWithSamples: [],
  memberBatchClaims: [
    { creditBatchId: "batch-1", applicationIds: ["application-1"] },
  ],
  memberBatches: [{ id: "batch-1" }],
  latestSubmission: null,
} as unknown as RemovalSubmissionContext;

function inventoryDocument(documentId: string) {
  const binding = classifyRemovalSourceCandidate({
    documentType: "pdf",
    metadata: { logbookEvidenceType: "inventory" },
    lineage: {
      entityType: "application",
      entityId: "application-1",
      entityLabel: "Application APP-001",
    },
  });
  if (!binding) throw new Error("Inventory evidence must classify.");
  return { documentId, binding };
}

const plan = (supplied: Parameters<typeof planRemovalEvidence>[0]["supplied"]) =>
  planRemovalEvidence({
    orgCtx: ORG_CONTEXT,
    removalId: "removal-1",
    ctx,
    template,
    compiledBiocharApplicationIntents: [] as BiocharApplicationIntent[],
    supplied,
  });

beforeEach(() => vi.resetAllMocks());

describe("Removal evidence plan", () => {
  it("keeps a pending file out of the operational plan and in the semantic plan", async () => {
    const ready = inventoryDocument("document-ready");
    const pending = inventoryDocument("document-pending");

    const evidence = await plan({
      candidateSourceDocuments: [ready, pending] as never,
      sourceBindingCandidates: [{ ...ready, sourceId: "source-ready" }] as never,
    });

    expect(
      new Set(evidence.sourceBindingPlan.map((entry) => entry.documentId)),
    ).toEqual(new Set(["document-ready"]));
    expect(
      new Map(
        evidence.semanticSourceBindingPlan.map((entry) => [
          entry.documentId,
          entry.sourceId,
        ]),
      ),
    ).toEqual(
      new Map([
        ["document-ready", "source-ready"],
        ["document-pending", ""],
      ]),
    );
    expect(evidence.candidateDocumentIds).toEqual([
      "document-pending",
      "document-ready",
    ]);
    expect(evidence.sourceIds).toEqual(["source-ready"]);
    expect(evidence.datapointSourceIds).toEqual(["source-ready"]);
    expect(evidence.readySourceDocumentCount).toBe(1);
  });

  it("scopes both plans to the same credit batch membership", async () => {
    const ready = inventoryDocument("document-ready");

    const evidence = await plan({
      candidateSourceDocuments: [ready] as never,
      sourceBindingCandidates: [{ ...ready, sourceId: "source-ready" }] as never,
    });

    expect(evidence.sourceBindingPlan.length).toBeGreaterThan(0);
    expect(evidence.semanticSourceBindingPlan).toEqual(
      evidence.sourceBindingPlan,
    );
  });

  it("trusts caller-owned Source IDs without walking or resolving documents", async () => {
    const evidence = await plan({ sourceIds: ["source-locked"] });

    expect(
      sources.collectCandidateSourceDocumentsForRemoval,
    ).not.toHaveBeenCalled();
    expect(sources.resolveSourceBindingCandidates).not.toHaveBeenCalled();
    expect(evidence.sourceIds).toEqual(["source-locked"]);
    expect(evidence.datapointSourceIds).toEqual(["source-locked"]);
    expect(evidence.sourceBindingPlan).toEqual([]);
    expect(evidence.semanticSourceBindingPlan).toEqual([]);
  });
});
