import { describe, expect, it, vi } from "vitest";

vi.mock("./sources", () => ({
  collectCandidateSourceDocumentsForRemoval: vi.fn(),
  resolveSourceBindingCandidates: vi.fn(),
}));

import type { RemovalSubmissionContext } from "./certify-context-core";
import { payloadHash } from "@/lib/isometric";
import {
  buildRemovalSubmissionBuild,
  compileRemovalSubmission,
  materializeRemovalSubmissionSnapshot,
  normalizeSequestrationTemplateForHash,
  removalTemplateTierCompatibilityBlocker,
} from "./removal-submission-build";
import * as sources from "./sources";

describe("buildRemovalSubmissionBuild", () => {
  it("keeps template-tier compatibility as an independent compile blocker", () => {
    const blocker = removalTemplateTierCompatibilityBlocker(
      {
        batchesWithSamples: [{ durabilityOption: "200_year" }],
      } as RemovalSubmissionContext,
      {
        groups: [
          {
            components: [
              { blueprint_key: "biochar_sequestration_1000_year" },
            ],
          },
        ],
      } as never,
    );

    expect(blocker).toMatch(/uses 200-year durability/i);
    expect(blocker).toMatch(/biochar_sequestration_1000_year/);
  });

  it("returns compile blockers instead of constructing transport for missing readiness", async () => {
    const compiled = await compileRemovalSubmission({
      orgCtx: {} as never,
      removalId: "rem-test-missing-readiness",
      ctx: {} as RemovalSubmissionContext,
      defaultTemplate: {
        id: "rvt-test",
        display_name: "Test template",
      } as never,
      blueprintsByKey: new Map(),
      externalProjectId: "prj-test",
      allowPeriodInputStub: false,
      hasDurabilityComponents: false,
    });

    expect(compiled.blockers).toEqual([
      expect.stringMatching(/Removal review did not finish/i),
    ]);
    expect(compiled.transportPlan).toBeNull();
    expect(compiled.snapshot).toBeNull();
  });

  it("fails closed when a Removal template has no sequestration component", async () => {
    const compiled = await compileRemovalSubmission({
      orgCtx: {} as never,
      removalId: "rem-test-no-sequestration",
      ctx: {
        entityReadinessGaps: [],
        submissionWarnings: [],
      } as unknown as RemovalSubmissionContext,
      defaultTemplate: {
        id: "rvt-test",
        display_name: "Emissions-only template",
        groups: [],
      } as never,
      blueprintsByKey: new Map(),
      externalProjectId: "prj-test",
      allowPeriodInputStub: false,
      hasDurabilityComponents: false,
      sourceIds: ["src-test"],
      candidateDocumentIds: ["doc-test"],
    });

    expect(compiled.transportPlan).toBeNull();
    expect(compiled.blockers.join("\n")).toMatch(
      /no supported biochar sequestration component/i,
    );
  });

  it("fingerprints live sequestration component and input structure deterministically", () => {
    const templateShape = {
      groups: [
        {
          key: "sequestration",
          components: [
            {
              id: "rtc_1",
              blueprint_key: "biochar_sequestration_1000_year",
              inputs: [
                {
                  input_key: "product_mass",
                  type: "monitored",
                  quantity_kind: "mass",
                  datapoint_id: null,
                },
                {
                  input_key: "carbon_contents",
                  type: "monitored",
                  quantity_kind: "mass_fraction_dry_basis",
                  datapoint_id: null,
                },
              ],
            },
          ],
        },
      ],
    };
    const template = templateShape as never;
    const reordered = {
      groups: [
        {
          ...templateShape.groups[0],
          components: [
            {
              ...templateShape.groups[0].components[0],
              inputs: [...templateShape.groups[0].components[0].inputs].reverse(),
            },
          ],
        },
      ],
    } as never;
    const changed = {
      groups: [
        {
          ...templateShape.groups[0],
          components: [
            {
              ...templateShape.groups[0].components[0],
              id: "rtc_2",
            },
          ],
        },
      ],
    } as never;

    const baseline = payloadHash(
      normalizeSequestrationTemplateForHash(template),
    );
    expect(
      payloadHash(normalizeSequestrationTemplateForHash(reordered)),
    ).toBe(baseline);
    expect(
      payloadHash(normalizeSequestrationTemplateForHash(changed)),
    ).not.toBe(baseline);
  });

  it("fails closed when entity certification readiness was not evaluated", async () => {
    const ctx = {} as RemovalSubmissionContext;

    await expect(
      buildRemovalSubmissionBuild({
        orgCtx: {} as never,
        removalId: "rem-test-missing-readiness",
        ctx,
        defaultTemplate: {} as never,
        blueprintsByKey: new Map(),
        externalProjectId: "prj-test-missing-readiness",
        allowPeriodInputStub: false,
        hasDurabilityComponents: false,
      }),
    ).rejects.toThrow(/Removal review did not finish/i);

    expect(
      sources.collectCandidateSourceDocumentsForRemoval,
    ).not.toHaveBeenCalled();
    expect(sources.resolveSourceBindingCandidates).not.toHaveBeenCalled();
  });

  it("blocks entity certification gaps before preparing registry inputs", async () => {
    const ctx = {
      entityReadinessGaps: [
        "Application APP-TEST-001: Upload the application logbook",
      ],
    } as unknown as RemovalSubmissionContext;

    await expect(
      buildRemovalSubmissionBuild({
        orgCtx: {} as never,
        removalId: "rem-test-1",
        ctx,
        defaultTemplate: {} as never,
        blueprintsByKey: new Map(),
        externalProjectId: "prj-test-1",
        allowPeriodInputStub: false,
        hasDurabilityComponents: false,
      }),
    ).rejects.toThrow(/Complete these fields before submitting the Removal/i);

    expect(
      sources.collectCandidateSourceDocumentsForRemoval,
    ).not.toHaveBeenCalled();
    expect(sources.resolveSourceBindingCandidates).not.toHaveBeenCalled();
  });

  it("materializes the immutable Source binding plan in the ledger snapshot", () => {
    const sourceBindingPlan = [
      {
        documentId: "document-1",
        sourceId: "source-1",
        nomaRole: "inventory",
        lineage: {
          entityType: "application",
          entityId: "application-1",
          entityLabel: "Application APP-001",
        },
        intendedTarget: {
          kind: "sequestration",
          groupKey: "co2-stored",
          componentId: "component-sequestration",
          componentBlueprintKey: "carbon_rich_substance_sequestration",
          inputKey: "product_mass",
        },
        mappingRevision: "source-mapping-revision",
      },
    ] as const;

    const snapshot = materializeRemovalSubmissionSnapshot({
      compiled: {
        monitored: [],
        fixed: [],
        datapointBodyByKey: new Map(),
        sourceBindingPlan,
        memberCreditBatchIds: ["batch-1"],
        durabilityMeasurementSampleArgs: null,
      } as never,
      template: { groups: [] } as never,
      externalProjectId: "project-1",
      removalId: "removal-1",
      nextVersion: 2,
    });

    expect(snapshot.payloadSnapshot.sourceBindingPlan).toEqual(
      sourceBindingPlan,
    );
  });

  it("materializes the durability ledger Source on direct s_fraction Datapoints", () => {
    const sourceBindingPlan = [
      {
        documentId: "document-durability-ledger",
        sourceId: "source-durability-ledger",
        nomaRole: "durability_evidence_ledger",
        lineage: {
          entityType: "credit_batch",
          entityId: "batch-1",
          entityLabel: "Credit batch CB-001",
        },
        intendedTarget: {
          kind: "sequestration",
          groupKey: "co2-stored",
          componentId: "component-sequestration",
          componentBlueprintKey: "biochar_sequestration_1000_year",
          inputKey: "s_fraction",
          creditBatchIds: ["batch-1"],
        },
        mappingRevision: "source-mapping-revision",
      },
    ] as const;

    const snapshot = materializeRemovalSubmissionSnapshot({
      compiled: {
        monitored: [],
        fixed: [],
        datapointBodyByKey: new Map(),
        sourceBindingPlan,
        memberCreditBatchIds: ["batch-1"],
        semanticPayload: {},
        durabilityMeasurementSampleArgs: {
          removalId: "removal-1",
          externalProjectId: "project-1",
          batches: [
            {
              creditBatchId: "batch-1",
              creditBatchCode: "CB-001",
              facilityTimezone: "UTC",
              sampling: "sampled",
              declaredHToCorgRatio: null,
              durabilityOption: "1000_year",
              runs: [
                {
                  id: "run-1",
                  code: "RUN-001",
                  biocharDryMassKg: 1_000,
                },
              ],
              samples: [
                {
                  id: "sample-1",
                  totalCarbonPercent: 80,
                  sReflectanceFraction: 0.91,
                },
                {
                  id: "sample-2",
                  totalCarbonPercent: 82,
                  sReflectanceFraction: 0.92,
                },
                {
                  id: "sample-3",
                  totalCarbonPercent: 84,
                  sReflectanceFraction: 0.93,
                },
              ],
            },
          ],
          attributionByRunId: new Map([["run-1", 1]]),
          facilityReferenceSoilTemperature: null,
          measuredAt: "2026-07-27T00:00:00.000Z",
        },
      } as never,
      template: {
        groups: [
          {
            key: "co2-stored",
            components: [
              {
                id: "component-sequestration",
                blueprint_key: "biochar_sequestration_1000_year",
                inputs: [{ input_key: "s_fraction" }],
              },
            ],
          },
        ],
      } as never,
      externalProjectId: "project-1",
      removalId: "removal-1",
      nextVersion: 2,
    });

    const directDatapoints =
      snapshot.payloadSnapshot.transport.datapointBodies.filter(
        (datapoint) => datapoint.inputKey === "s_fraction",
      );
    expect(directDatapoints).toHaveLength(3);
    expect(
      directDatapoints.map((datapoint) => datapoint.body.source_ids),
    ).toEqual([
      ["source-durability-ledger"],
      ["source-durability-ledger"],
      ["source-durability-ledger"],
    ]);
  });
});
