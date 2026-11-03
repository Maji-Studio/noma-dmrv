import { describe, expect, it } from "vitest";
import { ATTENTION_PER_CHECK, capOrGroup, creditBatchAttention } from "./dashboard-attention";

const TODAY = "2026-11-03";
const ENDED = { endDate: "2026-10-31" };
const removal = (kind: "interrupted" | "submitted" | "not-submitted") => ({
  status: { kind },
  phase: kind === "submitted" ? "submitted" as const : "draft" as const,
});

describe("creditBatchAttention", () => {
  it("shows the interrupted Removal instead of a period row", () => {
    expect(creditBatchAttention(ENDED, [removal("submitted"), removal("interrupted")], TODAY))
      .toEqual({ interrupted: true, period: null });
    expect(creditBatchAttention({ endDate: "2026-12-31" }, [removal("interrupted")], TODAY))
      .toEqual({ interrupted: true, period: null });
  });

  it("awaits verification only once a Removal is submitted", () => {
    expect(creditBatchAttention(ENDED, [removal("submitted")], TODAY).period).toBe("submitted");
  });

  it("awaits verification when a newer draft follows a submitted version, as the batch page does", () => {
    const corrected = { status: { kind: "not-submitted" as const }, phase: "submitted" as const };
    expect(creditBatchAttention(ENDED, [corrected], TODAY).period).toBe("submitted");
  });

  it("reads not submitted yet with no Removal or only a draft", () => {
    expect(creditBatchAttention(ENDED, [], TODAY).period).toBe("notSubmitted");
    expect(creditBatchAttention(ENDED, [removal("not-submitted")], TODAY).period).toBe("notSubmitted");
  });

  it("adds nothing while the period is open", () => {
    expect(creditBatchAttention({ endDate: TODAY }, [removal("submitted")], TODAY)).toEqual({ interrupted: false, period: null });
  });
});

describe("capOrGroup", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, index) => `row-${index}`);

  it("keeps every record while the check fits its cap", () => {
    expect(capOrGroup(rows(ATTENTION_PER_CHECK), ATTENTION_PER_CHECK, () => "group")).toEqual(rows(ATTENTION_PER_CHECK));
  });

  it("folds an over-cap check into one grouped row", () => {
    const total = ATTENTION_PER_CHECK + 2;
    expect(capOrGroup(rows(ATTENTION_PER_CHECK), total, () => `group of ${total}`)).toEqual([`group of ${total}`]);
  });
});
