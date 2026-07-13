import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const unlockState = vi.hoisted(() => ({
  value: null as Date | null,
}));

vi.mock("@/hooks/use-production-processes", () => ({
  useProductionProcessesByFacility: () => ({
    data: [
      {
        id: "process-1",
        feedstockTypeId: "feedstock-1",
        samplingMethod: "method_b",
        methodBUnlockedAt: unlockState.value,
        eligibleSampleCount: 30,
        baselineTarget: 30,
        meetsBaseline: true,
      },
    ],
  }),
}));

import { FeedstockProcessChip } from "./feedstock-process-chip";

beforeEach(() => {
  unlockState.value = new Date("2026-02-01T12:00:00.000Z");
});

function render(batchStartDate: string): string {
  return renderToStaticMarkup(
    <FeedstockProcessChip
      facilityId="facility-1"
      feedstockTypeId="feedstock-1"
      batchStartDate={batchStartDate}
    />,
  );
}

describe("FeedstockProcessChip historical Method-B boundary", () => {
  it.each(["2026-01-31", "2026-02-01"])(
    "shows Method A for a batch starting %s",
    (batchStartDate) => {
      const html = render(batchStartDate);
      expect(html).toContain("Method A");
      expect(html).toContain("Historical batch");
    },
  );

  it("shows Method B after the unlock date", () => {
    const html = render("2026-02-02");
    expect(html).toContain("Method B");
    expect(html).not.toContain("Historical batch");
  });

  it.each([null, new Date(Number.NaN)])(
    "does not label an incomplete transition as historical",
    (methodBUnlockedAt) => {
      unlockState.value = methodBUnlockedAt;

      const html = render("2026-01-31");

      expect(html).toContain("Method A");
      expect(html).toContain("transition data is incomplete");
      expect(html).not.toContain("Historical batch");
    },
  );
});
