import { describe, expect, it } from "vitest";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { buildConsentAreas, groupState, preselectStepUp, toggleAll, togglePeg } from "./consent-areas";

const FEEDSTOCK_SCOPES: ApiScope[] = ["feedstocks:read", "feedstocks:write"];
const ORDER_SCOPES: ApiScope[] = ["orders:read", "orders:write"];
const ALL_SCOPES = [...FEEDSTOCK_SCOPES, ...ORDER_SCOPES];
const areas = buildConsentAreas(ALL_SCOPES);
const feedstocks = areas.find((area) => area.entity === "feedstocks")!;

describe("buildConsentAreas", () => {
  it("offers no lone write when its read is unavailable", () => {
    expect(buildConsentAreas(["feedstocks:write"])).toEqual([]);
  });

  it("offers the write when the read is included, whether new or already allowed", () => {
    expect(buildConsentAreas(FEEDSTOCK_SCOPES)).toEqual([expect.objectContaining({ read: "feedstocks:read", write: "feedstocks:write" })]);
  });
});

describe("togglePeg", () => {
  it("adds the read when switching a write on", () => {
    expect(togglePeg([], feedstocks, "write", true)).toEqual(["feedstocks:write", "feedstocks:read"]);
  });

  it("removes the write when switching a read off, preserving other areas", () => {
    expect(togglePeg(ALL_SCOPES, feedstocks, "read", false)).toEqual(ORDER_SCOPES);
  });
});

describe("toggleAll", () => {
  it("leaves allowed scopes untouched when toggling undecided writes off", () => {
    expect(toggleAll(ALL_SCOPES, areas, ORDER_SCOPES, "write", false)).toEqual([...FEEDSTOCK_SCOPES, "orders:read"]);
  });

  it("selects only undecided writes and their reads", () => {
    expect(toggleAll(FEEDSTOCK_SCOPES, areas, ORDER_SCOPES, "write", true)).toEqual([...FEEDSTOCK_SCOPES, "orders:write", "orders:read"]);
  });

  it("cascades read-off only to undecided writes and preserves allowed scopes", () => {
    const undecided: ApiScope[] = ["feedstocks:read", ...ORDER_SCOPES];
    expect(toggleAll(ALL_SCOPES, areas, undecided, "read", false)).toEqual(["feedstocks:write"]);
  });

  it("keeps an undecided write when its already allowed read is outside the decision", () => {
    expect(toggleAll(ALL_SCOPES, areas, ["feedstocks:write", ...ORDER_SCOPES], "read", false)).toEqual(FEEDSTOCK_SCOPES);
  });
});

describe("groupState", () => {
  it("reports on, off and mixed", () => {
    expect(groupState(FEEDSTOCK_SCOPES, FEEDSTOCK_SCOPES)).toBe("on");
    expect(groupState([], FEEDSTOCK_SCOPES)).toBe("off");
    expect(groupState(["feedstocks:read"], FEEDSTOCK_SCOPES)).toBe("mixed");
    expect(groupState([], [])).toBe("off");
  });
});

describe("preselectStepUp", () => {
  it("selects only refused scopes and their required reads", () => {
    expect(preselectStepUp(areas, ALL_SCOPES, ["feedstocks:write"])).toEqual(FEEDSTOCK_SCOPES);
    expect(preselectStepUp(areas, ALL_SCOPES, ["orders:read"])).toEqual(["orders:read"]);
  });

  it("keeps already allowed scopes out of the undecided selection", () => {
    expect(preselectStepUp(areas, ["feedstocks:write", ...ORDER_SCOPES], ["feedstocks:write", "orders:write"])).toEqual(["feedstocks:write", ...ORDER_SCOPES]);
    expect(preselectStepUp(areas, ORDER_SCOPES, ["feedstocks:write"])).toEqual([]);
  });

  it("ignores scopes without a peg, including lone writes", () => {
    expect(preselectStepUp(buildConsentAreas(["feedstocks:write"]), ["feedstocks:write"], ["feedstocks:write"])).toEqual([]);
    expect(preselectStepUp(areas, ALL_SCOPES, [])).toEqual([]);
  });
});
