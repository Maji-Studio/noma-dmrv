import { afterEach, describe, expect, it, vi } from "vitest";

import { getFacilitiesRead, getProductionRunsRead, getFacilityRead, getActiveOrganizationRead, getDashboardBatchScopeRead, getRecordUsedByChainRead } from "./client";

const TRANSPORT_ERROR =
  "The server could not be reached. Refresh the page and try again.";

function stubBrowserLocation(pathname = "/production-runs", search = "") {
  const replace = vi.fn();
  vi.stubGlobal("window", { location: { pathname, search, replace } });
  return replace;
}

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

  it("posts chain input with cancellation and preserves calendar dates", async () => {
    const chain = { self: { kind: "productionRun", id: RUN_ID, code: "PR-1", name: null,
      facilityId: FACILITY_ID, at: "2026-06-13", calendarDay: true },
      upstream: [], downstream: [], edges: [], creditBatches: [] };
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, data: chain }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const input = { kind: "productionRun" as const, id: RUN_ID };
    await expect(getRecordUsedByChainRead(input, { signal: controller.signal })).resolves.toEqual({ success: true, data: chain });
    expect(fetchMock).toHaveBeenCalledWith("/api/reads/record-used-by-chain", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      cache: "no-store", signal: controller.signal,
    });
  });

  it("preserves a missing chain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, data: null })));
    await expect(getRecordUsedByChainRead({ kind: "order", id: RUN_ID })).resolves.toEqual({ success: true, data: null });
  });

  it.each([
    ["facility detail", () => getFacilityRead(FACILITY_ID), "/api/reads/facilities/" + FACILITY_ID],
    ["active organization", () => getActiveOrganizationRead(), "/api/reads/organizations/active"],
  ] as const)("decodes all %s timestamps", async (_name, read, path) => {
    const timestamp = "2026-09-15T10:00:00.000Z";
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      success: true,
      data: { id: FACILITY_ID, createdAt: timestamp, updatedAt: timestamp, archivedAt: null },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await read();
    expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ method: "POST", cache: "no-store" }));
    expect(result.success).toBe(true);
    if (!result.success || !result.data) return;
    expect(result.data.createdAt).toEqual(new Date(timestamp));
    expect(result.data.updatedAt).toEqual(new Date(timestamp));
    if ("archivedAt" in result.data) expect(result.data.archivedAt).toBeNull();
  });

  it("decodes a populated facility archive timestamp", async () => {
    const timestamp = "2026-09-15T10:00:00.000Z";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, data: {
      id: FACILITY_ID, createdAt: timestamp, updatedAt: timestamp, archivedAt: timestamp,
    } })));
    const result = await getFacilityRead(FACILITY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.archivedAt).toEqual(new Date(timestamp));
  });

  // A dot segment resolves the interpolated path onto a neighbouring route, so
  // the read would answer with a different resource, which the caller stores as
  // the selected facility.
  it.each([".", "..", "not-a-uuid"])(
    "refuses the facility id %j instead of requesting a path it did not mean",
    async (facilityId) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(getFacilityRead(facilityId)).resolves.toEqual({
        success: false,
        error: "Facility was not found.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("preserves a missing active organization", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, data: null })));
    await expect(getActiveOrganizationRead()).resolves.toEqual({ success: true, data: null });
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

  it("keeps a null or absent timestamp null instead of the epoch", async () => {
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
                endTime: null,
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
    expect(result.data.items[0]?.endTime).toBeNull();
  });

  it("keeps an omitted nullable timestamp null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          success: true,
          data: {
            items: [
              {
                id: FACILITY_ID,
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

    const result = await getFacilitiesRead();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.items[0]?.archivedAt).toBeNull();
    expect(result.data.items[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("answers with a transport error when a gateway returns HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body>504 Gateway Timeout</body></html>", {
          status: 504,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );

    await expect(getFacilitiesRead()).resolves.toEqual({
      success: false,
      error: TRANSPORT_ERROR,
    });
  });

  // A parse failure is the transport's fault; it must never reach the operator
  // as a report that their filters were invalid.
  it("answers with a transport error when a JSON body cannot be parsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{ truncated", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      getProductionRunsRead({ facilityId: FACILITY_ID }),
    ).resolves.toEqual({ success: false, error: TRANSPORT_ERROR });
  });

  it("propagates an aborted read to the caller", async () => {
    const abortError = new DOMException("The read was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(getFacilitiesRead()).rejects.toBe(abortError);
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

  it("never shows the proxy's own error text to the operator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: "Email verification required" }, { status: 403 }),
      ),
    );

    await expect(getFacilitiesRead()).resolves.toEqual({
      success: false,
      error: "Verify your email to continue.",
    });
  });

  it("falls back to the transport message for any other proxy status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: "upstream connect error" }, { status: 502 }),
      ),
    );

    await expect(getFacilitiesRead()).resolves.toEqual({
      success: false,
      error: TRANSPORT_ERROR,
    });
  });

  it("sends the operator to sign in when the session has expired", async () => {
    const replace = stubBrowserLocation("/production-runs", "?facility=abc");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Unauthorized" }, { status: 401 }),
        ),
    );

    await expect(getFacilitiesRead()).resolves.toEqual({
      success: false,
      error: "Your session has ended. Sign in to continue.",
    });
    expect(replace).toHaveBeenCalledWith(
      `/login?from=${encodeURIComponent("/production-runs?facility=abc")}`,
    );
  });

  it("does not redirect again once the sign-in page is showing", async () => {
    const replace = stubBrowserLocation("/login", "?from=%2Fdashboard");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Unauthorized" }, { status: 401 }),
        ),
    );

    await getFacilitiesRead();

    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the conflict reference a failure envelope carries", async () => {
    const conflict = { entity: "productionRun", id: "run-1", code: "PR-001" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { success: false, error: "Overlaps PR-001.", conflict },
          { status: 409 },
        ),
      ),
    );

    await expect(getProductionRunsRead()).resolves.toEqual({
      success: false,
      error: "Overlaps PR-001.",
      conflict,
    });
  });

  // A blank code is the server's bug, not the operator's: the envelope falls
  // through to the unrecognized-body answer instead of rejecting the read with
  // the branding helper's programming-error throw.
  it("answers with a safe message when a conflict code is whitespace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            success: false,
            error: "Overlaps a run.",
            conflict: { entity: "productionRun", id: "run-1", code: "   " },
          },
          { status: 409 },
        ),
      ),
    );

    await expect(getProductionRunsRead()).resolves.toEqual({
      success: false,
      error: TRANSPORT_ERROR,
    });
  });
});

it("decodes activity timestamps, preserving null registry time and the opaque cursor", async () => {
  const { getCreditBatchActivityRead } = await import("./client");
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, data: {
    items: [{ id: RUN_ID, occurredAt: "2026-10-15T10:00:00.123Z", registryAt: null }], nextCursor: "opaque",
  } }));
  vi.stubGlobal("fetch", fetchMock);
  try {
    const result = await getCreditBatchActivityRead({ creditBatchId: RUN_ID, cursor: "previous", limit: 5 });
    expect(result).toMatchObject({ success: true, data: { nextCursor: "opaque", items: [{ occurredAt: new Date("2026-10-15T10:00:00.123Z"), registryAt: null }] } });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reads/credit-batches/activity");
  } finally { vi.unstubAllGlobals(); }
});

it("decodes summary latest timestamps and preserves an empty summary", async () => {
  const { getCreditBatchActivitySummaryRead } = await import("./client");
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ success: true, data: {
    total: 1, counts: [{ entityType: "document", action: "deleted", count: 1 }],
    latest: { occurredAt: "2026-10-15T10:00:00.123Z", registryAt: null, actor: null, record: { label: null, deleted: true } },
  } })).mockResolvedValueOnce(Response.json({ success: true, data: { total: 0, counts: [], latest: null } }));
  vi.stubGlobal("fetch", fetchMock);
  try {
    expect(await getCreditBatchActivitySummaryRead({ creditBatchId: RUN_ID })).toMatchObject({ success: true,
      data: { total: 1, latest: { occurredAt: new Date("2026-10-15T10:00:00.123Z"), registryAt: null } } });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reads/credit-batches/activity/summary");
    expect(await getCreditBatchActivitySummaryRead({ creditBatchId: RUN_ID })).toEqual({ success: true, data: { total: 0, counts: [], latest: null } });
  } finally { vi.unstubAllGlobals(); }
});


describe("dashboard batch scope read client", () => {
  const input = { facilityId: FACILITY_ID, creditBatchId: null };
  const data = {
    batchIds: [RUN_ID], recordIds: [RUN_ID],
    stationTotals: { suppliers: 0, feedstock: 0, production: 1, products: 0, deliveries: 0, applications: 0 },
    kpis: { feedstockProcessedDryTonnes: null, biocharProducedDryTonnes: 0, appliedToSoilDryTonnes: 0, co2eStoredTonnes: null },
    activity: [{ id: "event", code: "PR-1", title: "Production run completed", dateIso: "2026-01-01T10:00:00.000Z", href: `/production-runs?id=${RUN_ID}`, calendarDay: false }],
    downstreamComplete: true,
  };
  afterEach(() => vi.unstubAllGlobals());

  it("posts nullable batch input with cancellation and validates activity without converting ISO strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, data }));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    await expect(getDashboardBatchScopeRead(input, { signal })).resolves.toEqual({ success: true, data });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/reads/dashboard/batch-scope", expect.objectContaining({
      method: "POST", cache: "no-store", signal, body: JSON.stringify(input),
    }));
  });

  it.each([
    null,
    { ...data, activity: undefined },
    { ...data, activity: [{ ...data.activity[0], dateIso: "not-a-date" }] },
    { ...data, activity: [{ ...data.activity[0], href: null }] },
    { ...data, stationTotals: { ...data.stationTotals, production: "1" } },
    { ...data, kpis: { ...data.kpis, appliedToSoilDryTonnes: "0" } },
    { ...data, recordIds: [null] },
    { ...data, downstreamComplete: undefined },
  ])("refuses malformed successful scope data %#", async (invalid) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, data: invalid })));
    await expect(getDashboardBatchScopeRead(input)).resolves.toEqual({
      success: false, error: "The server returned an unreadable response. Refresh the page and try again.",
    });
  });

  it("preserves a selected batch's missing-record failure", async () => {
    const failure = { success: false, error: "Credit batch was not found." };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(failure, { status: 400 })));
    await expect(getDashboardBatchScopeRead({ ...input, creditBatchId: RUN_ID })).resolves.toEqual(failure);
  });
});
