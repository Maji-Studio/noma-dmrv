import { describe, expect, it } from "vitest";
import {
  creditBatchAttention,
  PERIOD_ENDED_NOT_SUBMITTED_TITLE,
  PERIOD_ENDED_SUBMITTED_TITLE,
} from "./dashboard-attention";

const TODAY = "2026-11-03";
const ENDED = { endDate: "2026-10-31" };
const removal = (kind: "interrupted" | "submitted" | "not-submitted") => ({
  status: { kind },
  phase: kind === "submitted" ? "submitted" as const : "draft" as const,
});

describe("creditBatchAttention", () => {
  it("shows the interrupted Removal instead of a period row", () => {
    expect(creditBatchAttention(ENDED, [removal("submitted"), removal("interrupted")], TODAY))
      .toEqual({ interrupted: true, periodTitle: null });
    expect(creditBatchAttention({ endDate: "2026-12-31" }, [removal("interrupted")], TODAY))
      .toEqual({ interrupted: true, periodTitle: null });
  });

  it("awaits verification only once a Removal is submitted", () => {
    expect(creditBatchAttention(ENDED, [removal("submitted")], TODAY).periodTitle).toBe(PERIOD_ENDED_SUBMITTED_TITLE);
  });

  it("awaits verification when a newer draft follows a submitted version, as the batch page does", () => {
    const corrected = { status: { kind: "not-submitted" as const }, phase: "submitted" as const };
    expect(creditBatchAttention(ENDED, [corrected], TODAY).periodTitle).toBe(PERIOD_ENDED_SUBMITTED_TITLE);
  });

  it("reads not submitted yet with no Removal or only a draft", () => {
    expect(creditBatchAttention(ENDED, [], TODAY).periodTitle).toBe(PERIOD_ENDED_NOT_SUBMITTED_TITLE);
    expect(creditBatchAttention(ENDED, [removal("not-submitted")], TODAY).periodTitle).toBe(PERIOD_ENDED_NOT_SUBMITTED_TITLE);
  });

  it("adds nothing while the period is open", () => {
    expect(creditBatchAttention({ endDate: TODAY }, [removal("submitted")], TODAY)).toEqual({ interrupted: false, periodTitle: null });
  });
});
