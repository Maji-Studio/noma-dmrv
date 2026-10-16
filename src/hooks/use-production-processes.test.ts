import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useQuery: vi.fn(), eligibility: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("@/fn/production-processes", () => ({ getMethodBEligibilityFn: mocks.eligibility }));

import { useMethodBEligibility } from "./use-production-processes";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eligibility.mockResolvedValue({ success: true, data: { productionProcessId: "historical" } });
});

describe("useMethodBEligibility", () => {
  it("sends the UTC batch day and separates its cache entry from other dates", async () => {
    useMethodBEligibility("facility", "feedstock", true, new Date("2025-06-01T23:30:00-02:00"));
    const [historical] = mocks.useQuery.mock.calls.at(-1)!;
    await expect(historical.queryFn()).resolves.toEqual({ productionProcessId: "historical" });
    expect(mocks.eligibility).toHaveBeenLastCalledWith({
      facilityId: "facility", feedstockTypeId: "feedstock", batchStartDate: "2025-06-02",
    });
    expect(historical.queryKey).toEqual(["production-processes", "eligibility", "facility", "feedstock", "2025-06-02"]);

    useMethodBEligibility("facility", "feedstock", true, new Date("2025-06-02T18:00:00Z"));
    expect(mocks.useQuery.mock.calls.at(-1)![0].queryKey).toEqual(historical.queryKey);
    useMethodBEligibility("facility", "feedstock", true, new Date("2025-06-03T00:00:00Z"));
    expect(mocks.useQuery.mock.calls.at(-1)![0].queryKey).not.toEqual(historical.queryKey);
    useMethodBEligibility("facility", "feedstock");
    const [current] = mocks.useQuery.mock.calls.at(-1)!;
    expect(current.queryKey).not.toEqual(historical.queryKey);
    await current.queryFn();
    expect(mocks.eligibility).toHaveBeenLastCalledWith({
      facilityId: "facility", feedstockTypeId: "feedstock", batchStartDate: undefined,
    });
  });

  it.each([
    ["facility", "feedstock", false], ["", "feedstock", true], ["facility", "", true],
  ] as const)("disables the query for pair (%s, %s) with enabled=%s", (facility, feedstock, enabled) => {
    useMethodBEligibility(facility, feedstock, enabled);
    expect(mocks.useQuery.mock.calls.at(-1)![0].enabled).toBe(false);
  });
});
