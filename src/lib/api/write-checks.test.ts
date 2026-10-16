import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { ApiHttpError } from "./http-error";
import { remainingDeadlineMs, withCurrentOnStale } from "./write-checks";

describe("withCurrentOnStale", () => {
  it("converts stale versions to a 412 carrying the current representation", async () => {
    const current = { id: "order-id", version: 2 };
    const readCurrent = vi.fn().mockResolvedValue(current);
    const result = withCurrentOnStale(async () => {
      throw new DomainError("stale_version", "The representation has changed.");
    }, { noun: "order", readCurrent });

    await expect(result).rejects.toBeInstanceOf(ApiHttpError);
    await expect(result).rejects.toMatchObject({
      status: 412,
      code: "stale_version",
      message: "The order has changed. Read the current representation before retrying.",
    });
    await expect(result).rejects.toHaveProperty("current", current);
    expect(readCurrent).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([
    new DomainError("conflict", "The write conflicts."),
    new Error("Unexpected failure."),
  ])("rethrows other errors unchanged: $message", async (error) => {
    const readCurrent = vi.fn();
    await expect(withCurrentOnStale(async () => {
      throw error;
    }, { noun: "order", readCurrent })).rejects.toBe(error);
    expect(readCurrent).not.toHaveBeenCalled();
  });

  it("returns successful results without reading the representation", async () => {
    const result = { id: "order-id" };
    const readCurrent = vi.fn();
    await expect(withCurrentOnStale(async () => result, { noun: "order", readCurrent })).resolves.toBe(result);
    expect(readCurrent).not.toHaveBeenCalled();
  });
});

describe("remainingDeadlineMs", () => {
  const now = 1_000;

  it.each([now - 1, now])("throws the deadline DomainError when expired at %i", (deadlineAt) => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(() => remainingDeadlineMs(deadlineAt)).toThrow(DomainError);
    expect(() => remainingDeadlineMs(deadlineAt)).toThrow(expect.objectContaining({
      code: "deadline_exceeded",
      message: "The request ran out of time before starting. Nothing was saved; retry it.",
      retryable: true,
    }));
  });

  it("returns the remaining budget", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const remaining = 500;
    expect(remainingDeadlineMs(now + remaining)).toBe(remaining);
  });
});
