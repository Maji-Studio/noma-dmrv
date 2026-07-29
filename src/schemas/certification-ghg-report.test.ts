import { describe, expect, it } from "vitest";
import {
  prepareGhgStatementReportSchema,
  submitGhgStatementDialogSchema,
} from "./certification";

const STATEMENT_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "22222222-2222-4222-8222-222222222222";
const PREPARATION_KEY = "33333333-3333-4333-8333-333333333333";
const reviewed =
  "The operator reviewed this section against the frozen report facts.";

describe("GHG Statement report action schemas", () => {
  it("requires bounded narratives and explicit human review", () => {
    const input = {
      ghgStatementId: STATEMENT_ID,
      preparationKey: PREPARATION_KEY,
      narratives: {
        systemBoundaryAndMethodology:
          "The operator reviewed the energy and transport boundaries.",
        evidenceIndex: reviewed,
        uncertaintyAndSensitivity: reviewed,
        dataQualityAndExceptions: reviewed,
        monitoringAndDurability: reviewed,
        approvalStatement: reviewed,
      },
      humanReviewAcknowledged: true,
    };

    expect(prepareGhgStatementReportSchema.safeParse(input).success).toBe(
      true,
    );
    expect(
      prepareGhgStatementReportSchema.safeParse({
        ...input,
        humanReviewAcknowledged: false,
      }).success,
    ).toBe(false);
    expect(
      prepareGhgStatementReportSchema.safeParse({
        ...input,
        narratives: {
          ...input.narratives,
          evidenceIndex: "",
        },
      }).success,
    ).toBe(false);
  });

  it("accepts one approved generated report or one explicit external fallback", () => {
    expect(
      submitGhgStatementDialogSchema.safeParse({ reportId: REPORT_ID }).success,
    ).toBe(true);
    expect(
      submitGhgStatementDialogSchema.safeParse({
        externalReportUrl: "https://vvb.example/report.pdf",
      }).success,
    ).toBe(true);
    expect(submitGhgStatementDialogSchema.safeParse({}).success).toBe(false);
    expect(
      submitGhgStatementDialogSchema.safeParse({
        reportId: REPORT_ID,
        externalReportUrl: "https://vvb.example/report.pdf",
      }).success,
    ).toBe(false);
  });
});
