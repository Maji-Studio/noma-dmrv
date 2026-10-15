import { expect, it } from "vitest";
import { ghgStatusRegistryAt } from "./ghg-status-registry-at";

const SUBMITTED_AT = "2026-10-10T10:00:00Z";
const ISSUED_AT = "2026-10-14T10:00:00Z";

it.each([
  ["AWAITING_VERIFICATION", SUBMITTED_AT],
  ["CREDITS_ISSUED", ISSUED_AT],
  ["VERIFIED", null],
  ["FAILED_VERIFICATION", null],
  ["DRAFT", null],
] as const)("uses only the timestamp for %s", (status, expected) => {
  expect(ghgStatusRegistryAt({ status, submitted_at: SUBMITTED_AT, credits_issued_at: ISSUED_AT }))
    .toEqual(expected ? new Date(expected) : null);
});

it.each(["AWAITING_VERIFICATION", "CREDITS_ISSUED"] as const)("leaves missing %s timestamps null", (status) => {
  expect(ghgStatusRegistryAt({ status, submitted_at: null, credits_issued_at: null })).toBeNull();
});

it.each(["AWAITING_VERIFICATION", "CREDITS_ISSUED"] as const)("leaves invalid %s timestamps null", (status) => {
  expect(ghgStatusRegistryAt({ status, submitted_at: "invalid", credits_issued_at: "invalid" })).toBeNull();
});
