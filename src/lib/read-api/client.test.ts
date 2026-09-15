import { afterEach, describe, expect, it, vi } from "vitest";

import { getFacilitiesRead, getProductionRunsRead } from "./client";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("authenticated read client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts independent resource reads without waiting for an earlier response", async () => {
    const facilitiesResponse = deferredResponse();
    const runsResponse = deferredResponse();
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, init });
      return requests.length === 1
        ? facilitiesResponse.promise
        : runsResponse.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const facilities = getFacilitiesRead(
      { pageSize: 100 },
      { signal: controller.signal },
    );
    const runs = getProductionRunsRead(
      { facilityId: FACILITY_ID, page: 1, pageSize: 20 },
      { signal: controller.signal },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(requests[0]?.input)).toContain("/api/reads/facilities");
    expect(String(requests[1]?.input)).toContain("/api/reads/production-runs");
    expect(String(requests[1]?.input)).not.toContain(FACILITY_ID);
    expect(requests[0]?.init).toMatchObject({
      cache: "no-store",
      method: "POST",
      signal: controller.signal,
    });
    expect(requests[1]?.init).toMatchObject({
      cache: "no-store",
      method: "POST",
      signal: controller.signal,
    });
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      facilityId: FACILITY_ID,
      page: 1,
      pageSize: 20,
    });

    facilitiesResponse.resolve(
      Response.json({
        success: true,
        data: { items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 },
      }),
    );
    runsResponse.resolve(
      Response.json({
        success: true,
        data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
      }),
    );

    await expect(facilities).resolves.toMatchObject({ success: true });
    await expect(runs).resolves.toMatchObject({ success: true });
  });

  it("rehydrates the Production Run date fields declared by the JSON contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          success: true,
          data: {
            items: [
              {
                id: RUN_ID,
                startTime: "2026-09-15T08:00:00.000Z",
                endTime: "2026-09-15T10:00:00.000Z",
                createdAt: "2026-09-15T10:01:00.000Z",
                updatedAt: "2026-09-15T10:02:00.000Z",
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          },
        }),
      ),
    );

    const result = await getProductionRunsRead();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.items[0]?.startTime).toEqual(
      new Date("2026-09-15T08:00:00.000Z"),
    );
    expect(result.data.items[0]?.endTime).toEqual(
      new Date("2026-09-15T10:00:00.000Z"),
    );
    expect(result.data.items[0]?.createdAt).toBeInstanceOf(Date);
    expect(result.data.items[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it("preserves the server's formatted error result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            success: false,
            error: "Facility was not found in this Organization.",
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      getProductionRunsRead({ facilityId: FACILITY_ID }),
    ).resolves.toEqual({
      success: false,
      error: "Facility was not found in this Organization.",
    });
  });

  it("preserves an authentication error returned by API middleware", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: "Authentication required" },
          { status: 403 },
        ),
      ),
    );

    await expect(getFacilitiesRead()).resolves.toEqual({
      success: false,
      error: "Authentication required",
    });
  });
});
