import { expect, it } from "vitest";
import { coversBatches } from "./covered-contenders";

it("requires coverage even for an empty contender result", () => {
  const read = { contenders: [], batchIds: ["A"] };
  expect(coversBatches(read, ["A"])).toBe(true);
  expect(coversBatches(read, ["A", "B"])).toBe(false);
  expect(coversBatches(undefined, [])).toBe(false);
});

it("does not reuse results across claimed attempts or for an unclaimed read", () => {
  const claimedAttempt = { removalId: "removal", submissionId: "attempt" };
  const read = { contenders: [], batchIds: ["A"], claimedAttempt };
  expect(coversBatches(read, ["A"], claimedAttempt)).toBe(true);
  expect(coversBatches(read, ["A"])).toBe(false);
  expect(coversBatches(read, ["A"], { ...claimedAttempt, submissionId: "other" })).toBe(false);
  expect(coversBatches(read, ["A"], { ...claimedAttempt, removalId: "other" })).toBe(false);
});
