import { describe, expect, it } from "vitest";
import {
  buildSubmitGhgStatementDialogSchema,
  prepareGhgStatementReportSchema,
  submitGhgStatementDialogSchema,
} from "./certification";

const STATEMENT_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "22222222-2222-4222-8222-222222222222";
const PREPARATION_KEY = "33333333-3333-4333-8333-333333333333";
describe("GHG Statement report action schemas", () => {
  it("accepts the statement and idempotency key without operator prose", () => {
    const input = {
      ghgStatementId: STATEMENT_ID,
      preparationKey: PREPARATION_KEY,
    };

    expect(prepareGhgStatementReportSchema.safeParse(input).success).toBe(
      true,
    );
    expect(
      prepareGhgStatementReportSchema.safeParse({
        ...input,
        ensureFirst: true,
      }).success,
    ).toBe(true);
    expect(
      prepareGhgStatementReportSchema.safeParse({
        preparationKey: PREPARATION_KEY,
      }).success,
    ).toBe(false);
    expect(
      prepareGhgStatementReportSchema.safeParse({
        ghgStatementId: STATEMENT_ID,
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

  it("lets the UI validate confirmation fields before it generates the report", () => {
    const uiSchema = buildSubmitGhgStatementDialogSchema({
      isResubmit: false,
      isProduction: false,
      requireReportSource: false,
    });

    expect(uiSchema.safeParse({}).success).toBe(true);
    expect(submitGhgStatementDialogSchema.safeParse({}).success).toBe(false);
  });
});
