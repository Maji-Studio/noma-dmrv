import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGhgStatementReportModel,
  GhgStatementReportReconciliationError,
} from "@/lib/certification/ghg-statement-report/model";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";

const REMOVAL_A = "11111111-1111-4111-8111-111111111111";
const REMOVAL_B = "22222222-2222-4222-8222-222222222222";
const semanticB = {
  projectId: "prj_1",
  inputs: [{ key: "energy", value: 2 }],
};
const semanticA = {
  projectId: "prj_1",
  inputs: [{ key: "transport", value: 1 }],
};

const narratives = {
  systemBoundaryAndMethodology:
    "The reviewed boundary covers production, processing, transport, application, energy use, characterization, and storage.",
  evidenceIndex:
    "Evidence is indexed through the immutable Source bindings captured by each submitted Removal snapshot.",
  uncertaintyAndSensitivity:
    "The reviewer checked the reported uncertainty inputs and the current Isometric sensitivity analysis.",
  dataQualityAndExceptions:
    "The reviewer checked data-quality classifications, exclusions, incidents, and reporting-period exceptions.",
  monitoringAndDurability:
    "The reviewer checked monitoring coverage and the durability evidence referenced by each submitted Removal.",
  approvalStatement:
    "I reviewed the generated facts and these qualitative statements for this reporting period.",
};

const removalSnapshots = [
  {
    localRemovalId: REMOVAL_B,
    externalRemovalId: "rmv_b",
    submissionVersion: 2,
    payloadHash: payloadHash(semanticB),
    payloadSnapshot: {
      semantic: semanticB,
      memberCreditBatchIds: ["batch-b"],
      transport: { datapointBodies: [] },
    },
  },
  {
    localRemovalId: REMOVAL_A,
    externalRemovalId: "rmv_a",
    submissionVersion: 1,
    payloadHash: payloadHash(semanticA),
    payloadSnapshot: {
      semantic: semanticA,
      memberCreditBatchIds: ["batch-a"],
      sourceBindingPlan: [
        { inputKey: "transport", sourceId: "src_transport" },
      ],
      transport: {
        datapointBodies: [
          { body: { source_ids: ["src_application"] } },
        ],
      },
    },
  },
];

const remoteEntries = [
  {
    id: "rmv_b",
    startedOn: "2026-07-16",
    completedOn: "2026-07-31",
    netRemovedKg: 202.125,
    netRemovedWithoutDiscountKg: 210,
    netRemovedStandardDeviationKg: 3,
    supplierCreditKg: 198,
    bufferPoolKg: 4.125,
  },
  {
    id: "rmv_a",
    startedOn: "2026-07-01",
    completedOn: "2026-07-15",
    netRemovedKg: 700,
    netRemovedWithoutDiscountKg: 725,
    netRemovedStandardDeviationKg: 5,
    supplierCreditKg: 685,
    bufferPoolKg: 15,
  },
];

function build() {
  return buildGhgStatementReportModel({
    reportVersion: 1,
    preparedAt: "2026-07-28T12:00:00.000Z",
    documentControl: {
      organizationName: "Test supplier",
      facilityCode: "FAC-01",
      externalProjectId: "prj_1",
      externalGhgStatementId: "ggs_1",
      reportingPeriodStartOn: "2026-07-01",
      reportingPeriodEndOn: "2026-07-31",
      standardVersion: "1.7",
      protocolVersion: "1.1.1",
    },
    authoritativeStatement: {
      externalRemovalIds: ["rmv_b", "rmv_a"],
      pendingTotalCo2eRemovedKg: 902.125,
    },
    removalSnapshots,
    remoteEntries,
    narratives,
  });
}

describe("GHG Statement report model", () => {
  it("deterministically reconciles live membership and totals to frozen Removal snapshots", () => {
    const first = build();
    const second = build();

    expect(first).toEqual(second);
    expect(first.entries.map((entry) => entry.externalRemovalId)).toEqual([
      "rmv_a",
      "rmv_b",
    ]);
    expect(first.totals).toEqual({
      netRemovedKg: 902.125,
      netRemovedWithoutDiscountKg: 935,
      uncertaintyDiscountKg: 32.875,
      supplierCreditKg: 883,
      bufferPoolKg: 19.125,
    });
    expect(first.entries[0]).toMatchObject({
      localRemovalId: REMOVAL_A,
      removalSubmissionVersion: 1,
      removalPayloadHash: payloadHash(semanticA),
      sourceBindings: ["src_application", "src_transport"],
    });
    expect(first.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed when live membership is not exactly represented locally", () => {
    expect(() =>
      buildGhgStatementReportModel({
        reportVersion: 1,
        preparedAt: "2026-07-28T12:00:00.000Z",
        documentControl: {
          organizationName: "Test supplier",
          facilityCode: "FAC-01",
          externalProjectId: "prj_1",
          externalGhgStatementId: "ggs_1",
          reportingPeriodStartOn: "2026-07-01",
          reportingPeriodEndOn: "2026-07-31",
          standardVersion: "1.7",
          protocolVersion: "1.1.1",
        },
        authoritativeStatement: {
          externalRemovalIds: ["rmv_a", "rmv_missing"],
          pendingTotalCo2eRemovedKg: 700,
        },
        removalSnapshots: [removalSnapshots[1]],
        remoteEntries: [remoteEntries[1]],
        narratives,
      }),
    ).toThrowError(GhgStatementReportReconciliationError);
  });

  it("fails closed when the statement total drifts from the live entry sum", () => {
    expect(() =>
      buildGhgStatementReportModel({
        reportVersion: 1,
        preparedAt: "2026-07-28T12:00:00.000Z",
        documentControl: {
          organizationName: "Test supplier",
          facilityCode: "FAC-01",
          externalProjectId: "prj_1",
          externalGhgStatementId: "ggs_1",
          reportingPeriodStartOn: "2026-07-01",
          reportingPeriodEndOn: "2026-07-31",
          standardVersion: "1.7",
          protocolVersion: "1.1.1",
        },
        authoritativeStatement: {
          externalRemovalIds: ["rmv_a", "rmv_b"],
          pendingTotalCo2eRemovedKg: 999,
        },
        removalSnapshots,
        remoteEntries,
        narratives,
      }),
    ).toThrowError(/total/i);
  });

  it("fails closed when a frozen Removal snapshot no longer matches its hash", () => {
    expect(() =>
      buildGhgStatementReportModel({
        reportVersion: 1,
        preparedAt: "2026-07-28T12:00:00.000Z",
        documentControl: {
          organizationName: "Test supplier",
          facilityCode: "FAC-01",
          externalProjectId: "prj_1",
          externalGhgStatementId: "ggs_1",
          reportingPeriodStartOn: "2026-07-01",
          reportingPeriodEndOn: "2026-07-31",
          standardVersion: "1.7",
          protocolVersion: "1.1.1",
        },
        authoritativeStatement: {
          externalRemovalIds: ["rmv_a", "rmv_b"],
          pendingTotalCo2eRemovedKg: 902.125,
        },
        removalSnapshots: [
          {
            ...removalSnapshots[0],
            payloadSnapshot: {
              ...removalSnapshots[0].payloadSnapshot,
              semantic: { ...semanticB, projectId: "prj_tampered" },
            },
          },
          removalSnapshots[1],
        ],
        remoteEntries,
        narratives,
      }),
    ).toThrowError(/payload hash/i);
  });
});

describe("GHG Statement report migration", () => {
  it("creates the referenced organization-scoped key before its composite foreign key", () => {
    const migration = readFileSync(
      new URL("../drizzle/0095_thick_the_enforcers.sql", import.meta.url),
      "utf8",
    );
    const referencedKey =
      'ADD CONSTRAINT "certifier_ghg_statements_id_organization_id_unique"';
    const compositeForeignKey =
      'ADD CONSTRAINT "certifier_ghg_statement_reports_ghg_statement_id_organization_id_certifier_ghg_statements_id_organization_id_fk"';

    expect(migration.indexOf(referencedKey)).toBeGreaterThanOrEqual(0);
    expect(migration.indexOf(compositeForeignKey)).toBeGreaterThanOrEqual(0);
    expect(migration.indexOf(referencedKey)).toBeLessThan(
      migration.indexOf(compositeForeignKey),
    );
  });
});
