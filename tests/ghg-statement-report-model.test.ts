import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGhgStatementReportModel,
  canonicalJson,
  GhgStatementReportReconciliationError,
} from "@/lib/certification/ghg-statement-report/model";

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
    ghgStatementId: "ggs_1",
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
    ghgStatementId: "ggs_1",
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
      configuredProtocolVersion: "1.1",
    },
    authoritativeStatement: {
      externalEntryIds: ["rmv_b", "rmv_a"],
      pendingTotalCo2eRemovedKg: 902.125,
    },
    remoteEntries,
  });
}

describe("canonicalJson", () => {
  it("orders keys by code unit rather than locale collation", () => {
    expect(canonicalJson({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
  });

  it("orders nested keys by code unit too", () => {
    expect(canonicalJson({ outer: { a: 1, B: 2 } })).toBe(
      '{"outer":{"B":2,"a":1}}',
    );
  });
});

describe("GHG Statement report model", () => {
  it("deterministically reconciles live membership and totals", () => {
    const first = build();
    const second = buildGhgStatementReportModel({
      ...buildInput(),
      authoritativeStatement: {
        ...buildInput().authoritativeStatement,
        externalEntryIds: ["rmv_a", "rmv_b"],
      },
      remoteEntries: [...remoteEntries].reverse(),
    });

    expect(first).toEqual(second);
    expect(first.modelVersion).toBe(3);
    expect(first.entries.map((entry) => entry.externalEntryId)).toEqual([
      "rmv_a",
      "rmv_b",
    ]);
    expect(first.totals).toEqual({
      statementNetRemovedKg: 902.125,
      netRemovedKg: 902.125,
      netRemovedWithoutDiscountKg: 935,
      uncertaintyDiscountKg: 32.875,
      supplierCreditKg: 883,
      bufferPoolKg: 19.125,
    });
    expect(first.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed when live membership is not represented exactly", () => {
    expect(() =>
      buildGhgStatementReportModel({
        ...buildInput(),
        authoritativeStatement: {
          externalEntryIds: ["rmv_a", "rmv_missing"],
          pendingTotalCo2eRemovedKg: 700,
        },
        remoteEntries: [remoteEntries[1]],
      }),
    ).toThrowError(GhgStatementReportReconciliationError);
  });

  it("fails closed when statement membership contains duplicates", () => {
    expect(() =>
      buildGhgStatementReportModel({
        ...buildInput(),
        authoritativeStatement: {
          externalEntryIds: ["rmv_a", "rmv_a"],
          pendingTotalCo2eRemovedKg: 1_400,
        },
        remoteEntries: [remoteEntries[1], remoteEntries[1]],
      }),
    ).toThrowError(/one-to-one/i);
  });

  it("fails closed when an entry belongs to another statement", () => {
    expect(() =>
      buildGhgStatementReportModel({
        ...buildInput(),
        remoteEntries: [
          remoteEntries[0],
          { ...remoteEntries[1], ghgStatementId: "ggs_other" },
        ],
      }),
    ).toThrowError(/another GHG Statement/i);
  });

  it("keeps the fingerprint stable across operator protocol-version edits", () => {
    const base = build();
    const edited = buildGhgStatementReportModel({
      ...buildInput(),
      documentControl: {
        ...buildInput().documentControl,
        configuredProtocolVersion: null,
      },
    });

    expect(edited.sourceFingerprint).toBe(base.sourceFingerprint);
  });

  it("changes the fingerprint when a pinned version changes", () => {
    const base = build();
    const repinned = buildGhgStatementReportModel({
      ...buildInput(),
      documentControl: {
        ...buildInput().documentControl,
        protocolVersion: "1.2.0",
      },
    });

    expect(repinned.sourceFingerprint).not.toBe(base.sourceFingerprint);
  });

  it("allows the statement total to use coarser issuance precision", () => {
    const model = buildGhgStatementReportModel({
      ...buildInput(),
      authoritativeStatement: {
        externalEntryIds: ["rmv_live"],
        pendingTotalCo2eRemovedKg: 1_500,
      },
      remoteEntries: [
        {
          id: "rmv_live",
          startedOn: "2026-08-03",
          completedOn: "2026-08-04",
          netRemovedKg: 1_502.1608971810922,
          netRemovedWithoutDiscountKg: 1_527.153951802095,
          netRemovedStandardDeviationKg: 24.99305462100288,
          supplierCreditKg: 1_470,
          bufferPoolKg: 30,
          ghgStatementId: "ggs_1",
        },
      ],
    });

    expect(model.totals).toMatchObject({
      statementNetRemovedKg: 1_500,
      netRemovedKg: 1_502.1608971810922,
      netRemovedWithoutDiscountKg: 1_527.153951802095,
      supplierCreditKg: 1_470,
      bufferPoolKg: 30,
    });
    expect(model.totals.uncertaintyDiscountKg).toBeCloseTo(
      24.99305462100288,
      10,
    );
  });
});

function buildInput() {
  return {
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
      configuredProtocolVersion: "1.1",
    },
    authoritativeStatement: {
      externalEntryIds: ["rmv_b", "rmv_a"],
      pendingTotalCo2eRemovedKg: 902.125,
    },
    remoteEntries,
  };
}

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
