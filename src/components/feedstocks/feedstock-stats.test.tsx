import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-1" }),
}));

const stats = vi.hoisted(() => ({
  value: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@/hooks/use-feedstocks", () => ({
  useFeedstockStats: () => ({ data: stats.value, isLoading: false }),
}));

const { FeedstockStats } = await import("./feedstock-stats");

describe("FeedstockStats missing quantities", () => {
  it("never synthesizes a zero total dry mass or average moisture", () => {
    stats.value = {
      totalFeedstocks: 4,
      completeFeedstocks: 0,
      missingDataFeedstocks: 4,
      totalDryMassKg: null,
      avgMoisturePercent: null,
    };

    const markup = renderToStaticMarkup(<FeedstockStats />);

    expect(markup).toContain(MISSING_VALUE.notRecorded);
    expect(markup).not.toContain("0 kg");
    expect(markup).not.toContain("0.0%");
  });

  it("still shows recorded quantities", () => {
    stats.value = {
      totalFeedstocks: 4,
      completeFeedstocks: 4,
      missingDataFeedstocks: 0,
      totalDryMassKg: 2500,
      avgMoisturePercent: 12.5,
    };

    const markup = renderToStaticMarkup(<FeedstockStats />);

    expect(markup).toContain("2.5 t");
    expect(markup).toContain("12.5%");
  });
});
