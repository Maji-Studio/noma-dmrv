import { describe, expect, it } from "vitest";
import { feedstockTransportOwners, hasLinkedFeedstock, linkedFeedstockIdsOwnedElsewhere, ownedTransportFeedstockIds, type FeedstockTransportDraw } from "./feedstock-transport-ownership";

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
  it("passes ownership from earlier failed and cancelled runs to the next complete run", () => {
    expect(feedstockTransportOwners([
      draw("cancelled", "2026-01-01", "cancelled"), draw("failed", "2026-02-01", "failed"), draw("next", "2026-03-01"),
    ]).get("early")).toBe("next");
  });
  it("passes ownership over an earlier running run to the next complete run", () => {
    expect(feedstockTransportOwners([
      draw("complete", "2026-03-01"), draw("running", "2026-02-01", "running"),
    ]).get("early")).toBe("complete");
  });
  it("leaves feedstock records linked only to running, failed or cancelled runs without an owner", () => {
    expect(feedstockTransportOwners([draw("running", "2026-01-01", "running")]).size).toBe(0);
    expect(feedstockTransportOwners([draw("cancelled", "2026-01-01", "cancelled")]).size).toBe(0);
    expect(feedstockTransportOwners([
      draw("cancelled", "2026-01-01", "cancelled"), draw("failed", "2026-02-01", "failed"),
    ]).size).toBe(0);
  });
});

it("collects unique owned feedstock IDs while preserving whether any feedstock is linked", () => {
  const runs = [
    { feedstocks: [{ id: "owned", ownsTransport: true }, { id: "elsewhere", ownsTransport: false }] },
    { feedstocks: [{ id: "owned", ownsTransport: true }] },
  ];
  expect(ownedTransportFeedstockIds(runs)).toEqual(["owned"]);
  expect(hasLinkedFeedstock(runs)).toBe(true);
  const elsewhere = [{ feedstocks: [{ id: "elsewhere", ownsTransport: false }] }];
  expect(ownedTransportFeedstockIds(elsewhere)).toEqual([]);
  expect(hasLinkedFeedstock(elsewhere)).toBe(true);
  expect(hasLinkedFeedstock([{ feedstocks: [] }])).toBe(false);
  expect(ownedTransportFeedstockIds([])).toEqual([]);
  expect(hasLinkedFeedstock([])).toBe(false);
});

it("lists linked feedstock ids owned elsewhere only when no run owns any of them", () => {
  const mixed = [
    { feedstocks: [{ id: "owned", ownsTransport: true }] },
    { feedstocks: [{ id: "elsewhere", ownsTransport: false }] },
  ];
  expect(linkedFeedstockIdsOwnedElsewhere(mixed)).toEqual([]);
  const allElsewhere = [
    { feedstocks: [{ id: "a", ownsTransport: false }, { id: "b", ownsTransport: false }] },
    { feedstocks: [{ id: "a", ownsTransport: false }] },
  ];
  expect(linkedFeedstockIdsOwnedElsewhere(allElsewhere)).toEqual(["a", "b"]);
  expect(linkedFeedstockIdsOwnedElsewhere([{ feedstocks: [] }])).toEqual([]);
});
