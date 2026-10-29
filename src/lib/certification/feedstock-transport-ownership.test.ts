import { describe, expect, it } from "vitest";
import { feedstockTransportOwners, type FeedstockTransportDraw } from "./feedstock-transport-ownership";

const draw = (runId: string, day: string, status = "complete", feedstockId = "early"): FeedstockTransportDraw => ({
  runId, feedstockId, status, startTime: new Date(`${day}T00:00:00Z`),
});

describe("feedstock transport ownership", () => {
  it("front-loads early and March deliveries without repeating them in April", () => {
    expect(feedstockTransportOwners([
      draw("apr", "2026-04-01"), draw("mar", "2026-03-01"), draw("feb", "2026-02-01"),
      draw("apr", "2026-04-01", "complete", "march"), draw("mar", "2026-03-01", "complete", "march"),
    ])).toEqual(new Map([["early", "feb"], ["march", "mar"]]));
  });
  it("breaks start-time ties by run ID independently of input order", () => {
    const draws = [draw("b", "2026-02-01"), draw("a", "2026-02-01")];
    expect(feedstockTransportOwners(draws).get("early")).toBe("a");
    expect(feedstockTransportOwners(draws.toReversed()).get("early")).toBe("a");
  });
  it("skips cancelled runs but retains failed real draws", () => {
    expect(feedstockTransportOwners([
      draw("cancelled", "2026-01-01", "cancelled"), draw("failed", "2026-02-01", "failed"), draw("complete", "2026-03-01"),
    ]).get("early")).toBe("failed");
    expect(feedstockTransportOwners([draw("cancelled", "2026-01-01", "cancelled")]).size).toBe(0);
  });
});
