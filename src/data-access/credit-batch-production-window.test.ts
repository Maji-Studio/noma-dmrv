import { describe, expect, it } from "vitest";
import { SafeError } from "@/lib/errors";
import { assertCreditBatchProductionWindow } from "./credit-batch-production-window";

describe("assertCreditBatchProductionWindow", () => {
  it("returns normalized bounds for an uncertified period longer than a month", () => {
    expect(assertCreditBatchProductionWindow("2026-1-1", "2026-4-30", null)).toEqual({
      startStr: "2026-01-01",
      endStr: "2026-04-30",
    });
  });

  it.each(["isometric", "puro_earth", "verra", null] as const)("keeps date validity and ordering guards for %s", (certifier) => {
    expect(() => assertCreditBatchProductionWindow("2026-02-30", "2026-04-30", certifier))
      .toThrow(new SafeError("Enter a valid date."));
    expect(() => assertCreditBatchProductionWindow("2026-04-30", "2026-01-01", certifier))
      .toThrow(new SafeError("End date must be after start date"));
  });

  it("retains the Isometric refusal as a SafeError with the same message", () => {
    expect(() => assertCreditBatchProductionWindow("2026-01-01", "2026-04-30", "isometric"))
      .toThrow(new SafeError("A credit batch may span at most one month (one calendar month; noma rule)."));
  });
});
