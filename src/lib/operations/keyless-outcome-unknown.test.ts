import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";

vi.mock("@/db", () => ({ db: {} }));
const { keylessOutcomeUnknown } = await import("./runner");

describe("keylessOutcomeUnknown", () => {
  it("replaces the retry-with-key advice for callers without an idempotency key", () => {
    const lost = new DomainError("outcome_unknown", "Retry with the same Idempotency-Key.");
    expect(keylessOutcomeUnknown(lost)).toMatchObject({
      code: "outcome_unknown", message: "The app could not confirm that it saved this change. Check the list before trying again.",
    });
  });
  it("passes every other error through unchanged", () => {
    const other = new DomainError("conflict", "Busy.");
    expect(keylessOutcomeUnknown(other)).toBe(other);
  });
});
