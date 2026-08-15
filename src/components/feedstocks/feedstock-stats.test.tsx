import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FeedstockStats as FeedstockStatsData } from "@/data-access/feedstocks";
import { MISSING_VALUE } from "@/lib/copy-utils";

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: () => [null, vi.fn()],
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-1" }),
}));
vi.mock("@/hooks/use-entities", () => ({
  useFeedstockTypes: () => ({ data: [] }),
}));

const stats = vi.hoisted(() => ({
  value: undefined as FeedstockStatsData | undefined,
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

  it("names the moisture stat as weighted and states the unfiltered scope", () => {
    stats.value = {
      totalFeedstocks: 1,
      completeFeedstocks: 1,
      missingDataFeedstocks: 0,
      totalDryMassKg: 1000,
      avgMoisturePercent: 10,
    };

    const markup = renderToStaticMarkup(<FeedstockStats />);

    expect(markup).toContain("Weighted Avg. Moisture");
    expect(markup).toContain("Totals cover all feedstock types.");
  });
});
