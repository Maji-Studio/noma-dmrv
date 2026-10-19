import { expect, it } from "vitest";
import { z } from "zod";
import { creditBatchRepresentationSchema, representCreditBatch, type CreditBatchRepresentationInput } from "./credit-batches";

const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const other = "ea31ace1-5b30-4443-adb4-26b43bfa5599";
const now = new Date("2026-10-06T12:00:00Z");
const row: CreditBatchRepresentationInput = {
  id, code: "CB-26-0001", version: 2, facilityId: id, feedstockTypeId: other, status: "pending", sampling: "sampled",
  startDate: "2026-09-01", endDate: "2026-09-30", archivedAt: null, createdAt: now, updatedAt: now,
};

it("projects the narrow lookup fields and strips the rich batch row", () => {
  const rich = {
    ...row, organizationId: "foreign", productionProcessId: id, hToCorgRatio: 0.3, fDurableCalculated: 0.8, value: 1, currency: "TZS",
    affidavitReference: "legacy", intendedUseConfirmation: "legacy", companyVerificationRef: "legacy", mixingTimelineDays: 14,
    durabilityOption: "1000_year", co2eStored: 12, rollups: { samples: 3 }, cursorCreatedAt: "2026-10-06T12:00:00.000000Z",
  };
  const data = representCreditBatch(rich as CreditBatchRepresentationInput);
  expect(Object.keys(data).sort()).toEqual(Object.keys(creditBatchRepresentationSchema.shape).sort());
  expect(data).toEqual({ ...row, createdAt: now.toISOString(), updatedAt: now.toISOString() });
  for (const field of ["organizationId", "productionProcessId", "hToCorgRatio", "fDurableCalculated", "durabilityOption", "co2eStored", "rollups", "value", "currency",
    "affidavitReference", "intendedUseConfirmation", "companyVerificationRef", "mixingTimelineDays"]) {
    expect(data).not.toHaveProperty(field);
  }
});

it("serializes the archive instant and keeps business dates as plain dates", () => {
  expect(representCreditBatch({ ...row, archivedAt: "2026-10-07T03:00:00+03:00" })).toMatchObject({ archivedAt: "2026-10-07T00:00:00.000Z", startDate: "2026-09-01", endDate: "2026-09-30" });
});

it("describes every published field", () => {
  const published = z.toJSONSchema(creditBatchRepresentationSchema);
  for (const field of Object.values(published.properties ?? {})) expect(typeof field === "object" && field.description).toBeTruthy();
});
