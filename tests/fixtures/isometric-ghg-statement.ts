import type {
  CertifierProjectRow,
} from "@/data-access/certification";
import type {
  CertifierGhgStatementRow,
  OpenRemoval,
} from "@/data-access/certifier-ghg-statements";
import type { CertifierRemovalRow } from "@/data-access/certifier-removals";
import type { GhgStatement } from "@/lib/isometric";

export const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
export const STATEMENT_ID = "22222222-2222-4222-8222-222222222222";
export const REMOVAL_ID = "33333333-3333-4333-8333-333333333333";
export const EXTERNAL_PROJECT_ID = "prj_test_1";
export const EXTERNAL_STATEMENT_ID = "ggs_test_1";
export const EXTERNAL_REMOVAL_ID = "rmv_test_1";
export const REPORTING_PERIOD_END = "2026-01-31";
export const IN_WINDOW_COMPLETED_ON = "2026-01-15";
export const REPORT_URL = "https://example.com/report.pdf";
export const REPORT_ID = "55555555-5555-4555-8555-555555555555";
export const REPORT_DOCUMENT_ID = "66666666-6666-4666-8666-666666666666";
export const GENERATED_REPORT_URL =
  `http://localhost:3100/api/ghg-statement-reports/${REPORT_ID}?token=opaque`;

export function makeStatementRow(): CertifierGhgStatementRow {
  return {
    id: STATEMENT_ID,
    provider: "isometric",
    facilityId: FACILITY_ID,
    reportingPeriodEndOn: REPORTING_PERIOD_END,
    reportingPeriodStartOn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CertifierGhgStatementRow;
}

export function makeOpenRemoval(
  overrides: Partial<CertifierRemovalRow> = {},
): OpenRemoval {
  return {
    removal: {
      id: REMOVAL_ID,
      facilityId: FACILITY_ID,
      provider: "isometric",
      startedOn: null,
      completedOn: IN_WINDOW_COMPLETED_ON,
      ghgStatementId: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as CertifierRemovalRow,
    externalId: EXTERNAL_REMOVAL_ID,
  };
}

export function makeMapping(): CertifierProjectRow {
  return {
    id: "cert-proj-1",
    facilityId: FACILITY_ID,
    provider: "isometric",
    externalProjectId: EXTERNAL_PROJECT_ID,
    protocolSlug: "biochar",
    protocolVersion: "1.2",
    defaultRemovalTemplateId: "rvt_1",
    webhookSecret: null,
    metadata: null,
    gensetEnergyYieldKwhPerLitre: 3.375,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CertifierProjectRow;
}

export function makeRemoteStatement(
  overrides: Partial<GhgStatement> = {},
): GhgStatement {
  return {
    id: EXTERNAL_STATEMENT_ID,
    project_id: EXTERNAL_PROJECT_ID,
    verifier: null,
    ghg_entry_ids: [EXTERNAL_REMOVAL_ID],
    removal_ids: [EXTERNAL_REMOVAL_ID],
    credit_allocation: null,
    ghg_statement_report_url: null,
    status: "DRAFT",
    reporting_period_start_at: "2026-01-01",
    reporting_period_end_at: REPORTING_PERIOD_END,
    submitted_at: null,
    credits_issued_at: null,
    pending_total_co2e_removed_kg: null,
    ...overrides,
  } as GhgStatement;
}
