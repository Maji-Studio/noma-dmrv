import { expect, it } from "vitest";
import { hasReturnedStatementStatus, isReturnedStatement } from "./record-lock";

it.each([
  ["FAILED_VERIFICATION", false, true], ["FAILED_VERIFICATION", true, true],
  ["DRAFT", true, true], ["DRAFT", false, false], [null, true, false],
  ["AWAITING_VERIFICATION", true, false], ["VERIFIED", true, false],
  ["CREDITS_ISSUED", true, false], ["UNKNOWN", true, false],
] as const)("recognizes persisted return status %s, verifier submission %s", (status, submittedToVerifier, returned) => {
  const statement = { id: "statement", status, submittedToVerifier, fresh: false };
  expect(hasReturnedStatementStatus(statement)).toBe(returned);
  expect(isReturnedStatement(statement)).toBe(false);
  expect(isReturnedStatement({ ...statement, fresh: true })).toBe(returned);
  expect(isReturnedStatement({ ...statement, fresh: true, inFlight: true })).toBe(false);
});
