import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_STATEMENT_ID,
  makeMapping,
  makeRemoteStatement,
  makeStatementRow,
  STATEMENT_ID,
} from "../../../tests/fixtures/isometric-ghg-statement";
import { testIsometricClient } from "../../../tests/fixtures/isometric-client";

const locks = vi.hoisted(() => ({
  connectionOpen: false,
  artifactHeld: false,
  facilityHeld: false,
  unsettledFetches: 0,
  unsettledFetchesAtRelease: [] as number[],
  released: vi.fn(),
}));
const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn(async () => ({ organizationId: "org-test", userId: "user-test", orgRole: "owner" })),
  requireOrgRole: vi.fn(),
}));
vi.mock("@/lib/log", () => ({
  sanitizeErrorMessage: () => "registry unavailable",
  logger: { warn, error: vi.fn(), child: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock("@/db", () => ({
  withDedicatedLockConnection: async (fn: (tx: unknown) => Promise<unknown>) => {
    locks.connectionOpen = true;
    try { return await fn({}); }
    finally {
      locks.unsettledFetchesAtRelease.push(locks.unsettledFetches);
      locks.artifactHeld = false;
      locks.connectionOpen = false;
      locks.released();
    }
  },
}));
vi.mock("@/data-access/facility-durability-lock", () => ({
  withFacilityDurabilitySessionLock: async (_ctx: unknown, _id: string, fn: () => Promise<unknown>) => {
    locks.facilityHeld = true;
    try { return await fn(); }
    finally { locks.facilityHeld = false; }
  },
}));
vi.mock("@/lib/certification/submission-lock", () => ({
  acquireCertificationArtifactLocksSorted: vi.fn(async () => { locks.artifactHeld = true; }),
}));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: vi.fn() }));
vi.mock("@/data-access/certifier-ghg-statements", () => ({ getCertifierGhgStatementById: vi.fn() }));
vi.mock("@/data-access/certification", () => ({
  getCertifierProjectByFacility: vi.fn(), getLatestSubmissionsForEntities: vi.fn(),
}));
vi.mock("@/data-access/facilities", () => ({ getFacilityById: vi.fn(async () => ({ code: "FAC-1" })) }));
vi.mock("@/data-access/organizations", () => ({ getActiveOrganization: vi.fn(async () => ({ name: "Test Organization" })) }));
vi.mock("@/data-access/ghg-statement-reports", () => ({
  getGhgStatementReportById: vi.fn(),
  getReportByPreparationKey: vi.fn(async () => null),
  getNextGhgStatementReportVersion: vi.fn(async () => 1),
  insertPreparedGhgStatementReport: vi.fn(),
}));
vi.mock("@/lib/certification/ghg-statement-report/pdf", () => ({ renderGhgStatementReportPdf: vi.fn() }));
vi.mock("@/lib/storage", () => ({ getStorageProvider: vi.fn(), buildStorageKey: vi.fn() }));

import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import { getCertifierGhgStatementById } from "@/data-access/certifier-ghg-statements";
import { getCertifierProjectByFacility, getLatestSubmissionsForEntities } from "@/data-access/certification";
import { getGhgStatementReportById, insertPreparedGhgStatementReport, type GhgStatementReportRow } from "@/data-access/ghg-statement-reports";
import { getStorageProvider } from "@/lib/storage";
import { renderGhgStatementReportPdf } from "@/lib/certification/ghg-statement-report/pdf";
import { approveGhgStatementReport, prepareGhgStatementReport } from "./ghg-statement-reports";
import { assertGhgStatementReportFresh, loadLiveReportFacts } from "./ghg-statement-report-core";
import { GHG_STATEMENT_REPORT_MODEL_VERSION } from "@/lib/certification/ghg-statement-report/model";
import { createIsometricClient } from "@/lib/isometric/client";
import { DomainError } from "@/lib/domain-errors";
import { withAction } from "../with-action";

const CALL_TIMEOUT_MS = 30_000;
const SLOW_READ_LATENCY_MS = CALL_TIMEOUT_MS - 1_000;
const READ_DEADLINE_MS = 60_000;
const READ_PER_ENTRY_MS = 5_000;
const READ_MAX_DEADLINE_MS = 300_000;
const READ_CONCURRENCY = 4;
const SIBLING_ENTRY_COUNT = 12;
// client.ts: MAX_ATTEMPTS and BASE_DELAY_MS, with Math.random fixed at 1.
const CLIENT_MAX_ATTEMPTS = 3;
const CLIENT_BASE_DELAY_MS = 500;
const RETRY_BACKOFF_BUDGET_MS = CLIENT_BASE_DELAY_MS * (2 ** (CLIENT_MAX_ATTEMPTS - 1) - 1);
const INITIAL_ENTRY_READ_CALL_COUNT = 1 + READ_CONCURRENCY; // Statement plus the first worker wave.
const RETRIED_ENTRY_READ_CALL_COUNT = INITIAL_ENTRY_READ_CALL_COUNT + CLIENT_MAX_ATTEMPTS - 1;
// Eight waves at REPORT_REGISTRY_READ_CONCURRENCY finish before the capped deadline.
const STALL_AFTER_ENTRY_COUNT = 32;
const FETCH_ABORT_SETTLEMENT_MS = 1;
const HEALTHY_ENTRY_COUNT = 100;
const HEALTHY_ENTRY_LATENCY_MS = 3_000;
const PREPARATION_KEY = "44444444-4444-4444-8444-444444444444";
const REPORT_ID = "55555555-5555-4555-8555-555555555555";
const orgCtx = { organizationId: "org-test", userId: "user-test", orgRole: "owner", isPlatformAdmin: false } as const;
const report = {
  id: REPORT_ID,
  ghgStatementId: STATEMENT_ID,
  version: 1,
  preparedAt: new Date("2026-01-31T12:00:00.000Z"),
  reportModel: { modelVersion: GHG_STATEMENT_REPORT_MODEL_VERSION },
} as GhgStatementReportRow;
const retryMessage = `GHG Statement ${EXTERNAL_STATEMENT_ID} could not be read from Isometric. Try again shortly.`;
const refusalMessage = `GHG Statement ${EXTERNAL_STATEMENT_ID} could not be read from Isometric. Check the GHG Statement in Isometric or the registry connection.`;
const fetchMock = vi.fn<typeof fetch>();
const prepare = () => prepareGhgStatementReport({ ghgStatementId: STATEMENT_ID, preparationKey: PREPARATION_KEY });
const loadFacts = () => loadLiveReportFacts(orgCtx, {
  ghgStatementId: STATEMENT_ID, reportVersion: 1, preparedAt: report.preparedAt.toISOString(),
});

function remoteEntry(id: string) {
  return {
    id,
    ghg_statement_id: EXTERNAL_STATEMENT_ID,
    credit_type: "REMOVAL",
    started_on: "2026-01-01",
    completed_on: "2026-01-15",
    co2e_net_removed_kg: 1,
    co2e_net_removed_without_discount_kg: 1,
    co2e_net_removed_standard_deviation_kg: 0,
  };
}

function stalledFetch(_url: unknown, init?: RequestInit): Promise<Response> {
  locks.unsettledFetches += 1;
  return new Promise<Response>((_resolve, reject) => {
    // Abort delivery precedes asynchronous transport cleanup and settlement.
    init!.signal!.addEventListener("abort", () => {
      setTimeout(() => reject(init!.signal!.reason), FETCH_ABORT_SETTLEMENT_MS);
    }, { once: true });
  }).finally(() => {
    locks.unsettledFetches -= 1;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  locks.unsettledFetches = 0;
  locks.unsettledFetchesAtRelease = [];
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(Math, "random").mockReturnValue(1);
  vi.mocked(resolveIsometricClient).mockResolvedValue(testIsometricClient());
  vi.mocked(getCertifierGhgStatementById).mockResolvedValue({ ...makeStatementRow(), reportingPeriodStartOn: "2026-01-01" });
  vi.mocked(getCertifierProjectByFacility).mockResolvedValue(makeMapping());
  vi.mocked(getLatestSubmissionsForEntities).mockResolvedValue(new Map([[STATEMENT_ID, { externalId: EXTERNAL_STATEMENT_ID }]]) as never);
  vi.mocked(getGhgStatementReportById).mockResolvedValue(report);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function expectReleasedWithoutReport() {
  expect(locks).toMatchObject({ connectionOpen: false, artifactHeld: false, facilityHeld: false });
  expect(locks.released).toHaveBeenCalledOnce();
  expect(locks.unsettledFetchesAtRelease).toEqual([0]);
  expect(renderGhgStatementReportPdf).not.toHaveBeenCalled();
  expect(getStorageProvider).not.toHaveBeenCalled();
  expect(insertPreparedGhgStatementReport).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
}

describe("report preparation registry budget", () => {
  it.each([400, 401, 403, 404, 422, 501, 505, 511])("returns a coded corrective message for %i", async (status) => {
    fetchMock.mockResolvedValue(new Response("refused", { status }));
    const outcome = prepare();
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual({ success: false, code: "registry_read_refused", error: refusalMessage });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
    expectReleasedWithoutReport();
  });

  it.each(["prepare", "approve", "submit freshness"])("preserves missing-credentials guidance for %s", async (flow) => {
    vi.mocked(resolveIsometricClient).mockResolvedValue(createIsometricClient(null));
    const outcome = flow === "prepare" ? prepare() : flow === "approve"
      ? approveGhgStatementReport({ ghgStatementId: STATEMENT_ID, reportId: REPORT_ID, version: 1 })
      : withAction((ctx) => assertGhgStatementReportFresh(ctx, report));
    expect(await outcome).toEqual({
      success: false,
      code: "registry_not_configured",
      error: "The registry connection is not configured for this Organization. Ask an Owner or Admin to add the connection credentials.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["approve", "submit freshness"])("returns neutral retry copy for %s", async (flow) => {
    fetchMock.mockRejectedValue(new Error("connection lost"));
    const outcome = flow === "approve"
      ? approveGhgStatementReport({ ghgStatementId: STATEMENT_ID, reportId: REPORT_ID, version: 1 })
      : withAction((ctx) => assertGhgStatementReportFresh(ctx, report));
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual({ success: false, code: "registry_unavailable", error: retryMessage });
    expect(warn).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([408, 425, 429, 503])("marks an exhausted %i read as retryable", async (status) => {
    fetchMock.mockImplementation(async () => new Response("busy", { status }));
    const outcome = loadFacts().catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await outcome;
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "registry_unavailable", retryable: true, message: retryMessage });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("caps the entry-scaled deadline and drains in-flight reads", async () => {
    const entryIds = Array.from({ length: HEALTHY_ENTRY_COUNT }, (_, index) => `entry-${index}`);
    fetchMock.mockResolvedValueOnce(Response.json(makeRemoteStatement({
      pending_total_co2e_removed_kg: HEALTHY_ENTRY_COUNT, ghg_entry_ids: entryIds,
    })));
    fetchMock.mockImplementation(async (url, init) => {
      const index = Number(String(url).split("entry-").at(-1));
      if (index >= STALL_AFTER_ENTRY_COUNT) return stalledFetch(url, init);
      await new Promise((resolve) => setTimeout(resolve, SLOW_READ_LATENCY_MS));
      return Response.json(remoteEntry(`entry-${index}`));
    });
    const outcome = prepare();
    await vi.advanceTimersByTimeAsync(READ_MAX_DEADLINE_MS - 1);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(FETCH_ABORT_SETTLEMENT_MS);
    expect(await outcome).toMatchObject({ success: false, code: "registry_unavailable" });
    expect(warn).toHaveBeenCalledOnce();
    expectReleasedWithoutReport();
  });

  it("starts queued reads as workers finish and preserves entry order", async () => {
    const entryIds = ["entry-4", "entry-3", "entry-2", "entry-1", "entry-0"];
    fetchMock.mockResolvedValueOnce(Response.json(makeRemoteStatement({
      pending_total_co2e_removed_kg: 5,
      ghg_entry_ids: entryIds,
    })));
    fetchMock.mockImplementation(async (url) => {
      const id = String(url).split("/").at(-1)!;
      await new Promise((resolve) => setTimeout(resolve, id === "entry-4" ? 2_000 : 100));
      return Response.json(remoteEntry(id));
    });
    const outcome = loadFacts();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await vi.runAllTimersAsync();
    const facts = await outcome;
    expect(facts.input.remoteEntries.map((entry) => entry.id)).toEqual(entryIds);
    expect(facts.input.authoritativeStatement.pendingTotalCo2eRemovedKg).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads many healthy entries beyond the old fixed deadline with bounded concurrency", async () => {
    const entryIds = Array.from({ length: HEALTHY_ENTRY_COUNT }, (_, index) => `entry-${index}`);
    fetchMock.mockResolvedValueOnce(Response.json(makeRemoteStatement({
      pending_total_co2e_removed_kg: HEALTHY_ENTRY_COUNT, ghg_entry_ids: entryIds,
    })));
    let inFlight = 0;
    let peakInFlight = 0;
    fetchMock.mockImplementation(async (url) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, HEALTHY_ENTRY_LATENCY_MS));
      inFlight -= 1;
      return Response.json(remoteEntry(String(url).split("/").at(-1)!));
    });
    const startedAt = Date.now();
    const outcome = loadFacts();
    await vi.runAllTimersAsync();
    const facts = await outcome;
    expect(Date.now() - startedAt).toBeGreaterThan(READ_DEADLINE_MS);
    expect(peakInFlight).toBe(READ_CONCURRENCY);
    expect(facts.input.remoteEntries.map((entry) => entry.id)).toEqual(entryIds);
    expect(fetchMock).toHaveBeenCalledTimes(HEALTHY_ENTRY_COUNT + 1);
    expect(vi.getTimerCount()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([400, 503])("cancels sibling entry reads after a %i failure and starts no queued reads", async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json(makeRemoteStatement({
      pending_total_co2e_removed_kg: 1,
      ghg_entry_ids: Array.from({ length: SIBLING_ENTRY_COUNT }, (_, index) => `entry-${index}`),
    })));
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/entry-0")) return new Response("unavailable", { status });
      return stalledFetch(url, init);
    });
    const outcome = prepare();
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_BUDGET_MS + FETCH_ABORT_SETTLEMENT_MS);
    expect(await outcome).toMatchObject({
      success: false,
      code: status === 400 ? "registry_read_refused" : "registry_unavailable",
      error: status === 400 ? refusalMessage : retryMessage,
    });
    expect(fetchMock).toHaveBeenCalledTimes(status === 400 ? INITIAL_ENTRY_READ_CALL_COUNT : RETRIED_ENTRY_READ_CALL_COUNT);
    expectReleasedWithoutReport();
    expect(warn).toHaveBeenCalledTimes(status === 400 ? 0 : 1);
  });

  it("cancels a Retry-After wait when the phase deadline expires", async () => {
    fetchMock.mockImplementation(async () => new Response("busy", { status: 429, headers: { "retry-after": "999999" } }));
    const outcome = prepare();
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS);
    expect(await outcome).toMatchObject({ success: false, error: expect.stringContaining(EXTERNAL_STATEMENT_ID) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectReleasedWithoutReport();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { ghgStatementId: STATEMENT_ID, externalGhgStatementId: EXTERNAL_STATEMENT_ID, reason: "deadline_exceeded" },
      "GHG Statement report registry read stopped",
    );
  });

  it.each(["statement", "entries"])("stops stalled %s reads at the shared deadline and releases the locks", async (phase) => {
    if (phase === "entries") {
      fetchMock.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, SLOW_READ_LATENCY_MS));
        return Response.json(makeRemoteStatement({
        pending_total_co2e_removed_kg: 1,
        ghg_entry_ids: Array.from({ length: SIBLING_ENTRY_COUNT }, (_, index) => `entry-${index}`),
        }));
      });
    }
    fetchMock.mockImplementation(stalledFetch);
    let settled = false;
    const outcome = prepare().then((result) => { settled = true; return result; });
    const deadlineMs = READ_DEADLINE_MS + (phase === "entries" ? SIBLING_ENTRY_COUNT * READ_PER_ENTRY_MS : 0);
    await vi.advanceTimersByTimeAsync(deadlineMs - 1);
    expect(settled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(phase === "statement" ? 2 : SIBLING_ENTRY_COUNT + 1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(FETCH_ABORT_SETTLEMENT_MS);
    expect(settled).toBe(true);
    expect(await outcome).toMatchObject({
      success: false,
      code: "registry_unavailable",
      error: retryMessage,
    });
    expectReleasedWithoutReport();
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(phase === "statement" ? 2 : SIBLING_ENTRY_COUNT + 1);
    expect(warn).toHaveBeenCalledOnce();
  });

  // Bounded registry calls — no explicit bound/backoff budget on registry calls made during report generation.
  it("returns an actionable failure after a slow read followed by registry errors", async () => {
    fetchMock.mockImplementationOnce(stalledFetch).mockImplementation(async () => new Response("busy", { status: 503 }));
    const outcome = prepare();
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS + FETCH_ABORT_SETTLEMENT_MS);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(locks.artifactHeld).toBe(true);
    await vi.advanceTimersByTimeAsync(CLIENT_BASE_DELAY_MS - 1);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CLIENT_BASE_DELAY_MS * 2);
    expect(await outcome).toEqual({
      success: false,
      code: "registry_unavailable",
      error: retryMessage,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expectReleasedWithoutReport();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { ghgStatementId: STATEMENT_ID, externalGhgStatementId: EXTERNAL_STATEMENT_ID, reason: "retry_budget_exhausted" },
      "GHG Statement report registry read stopped",
    );
  });
});
