/**
 * Route-level contract for the private read handlers: the success envelope, the
 * two authorization answers (no session vs no usable organization), rejected
 * input, and the facility guard that runs before any domain read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveOrgContext: vi.fn(),
  requireOrgFacility: vi.fn(),
  getFacilities: vi.fn(),
  getFacilityById: vi.fn(),
  getActiveOrganization: vi.fn(),
  getOnboardingStatus: vi.fn(),
  getDashboardOverview: vi.fn(),
  getProductionRuns: vi.fn(),
  getProductionRunStats: vi.fn(),
  getCreditBatches: vi.fn(),
  getCertifierProjectByFacility: vi.fn(),
  listFacilitiesLinkedToExternal: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/auth/server", () => ({
  resolveOrgContext: mocks.resolveOrgContext,
}));
vi.mock("@/data-access/utils", () => ({
  requireOrgFacility: mocks.requireOrgFacility,
}));
vi.mock("@/data-access/facilities", () => ({
  getFacilities: mocks.getFacilities,
  getFacilityById: mocks.getFacilityById,
}));
vi.mock("@/data-access/production-runs", () => ({
  getProductionRuns: mocks.getProductionRuns,
  getProductionRunStats: mocks.getProductionRunStats,
}));
vi.mock("@/data-access/credit-batches", () => ({
  getCreditBatches: mocks.getCreditBatches,
}));
vi.mock("@/data-access/certification", () => ({
  getCertifierProjectByFacility: mocks.getCertifierProjectByFacility,
  listFacilitiesLinkedToExternal: mocks.listFacilitiesLinkedToExternal,
}));
vi.mock("@/data-access/organizations", () => ({ getActiveOrganization: mocks.getActiveOrganization }));
vi.mock("@/data-access/onboarding", () => ({ getOnboardingStatus: mocks.getOnboardingStatus }));
vi.mock("@/data-access/dashboard-overview", () => ({ getDashboardOverview: mocks.getDashboardOverview }));
vi.mock("@/config/env", () => ({
  env: { ISOMETRIC_ENVIRONMENT: "sandbox" },
}));
vi.mock("@/lib/log", () => ({
  logger: mocks.logger,
  sanitizeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { SafeError } from "@/lib/errors";
import { POST as creditBatchesRoute } from "./credit-batches/route";
import { POST as certifierSummaryRoute } from "./facilities/[facilityId]/certifier-summary/route";
import { POST as facilitiesRoute } from "./facilities/route";
import { POST as productionRunsRoute } from "./production-runs/route";
import { POST as productionRunStatsRoute } from "./production-runs/stats/route";

import { POST as facilityRoute } from "./facilities/[facilityId]/route";
import { POST as activeOrganizationRoute } from "./organizations/active/route";
import { POST as onboardingRoute } from "./onboarding/status/route";
import { POST as dashboardRoute } from "./dashboard/overview/route";
import { DASHBOARD_SCHEMA_MISMATCH_MESSAGE } from "@/lib/read-models/dashboard-overview";

const ORG_CONTEXT = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "member" as const,
  isPlatformAdmin: false,
};
const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_FACILITY_ID = "22222222-2222-4222-8222-222222222222";
const MALFORMED_ID = "not-a-facility";
const TOO_LONG_SEARCH = "x".repeat(256);

const EMPTY_PAGE = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 0,
};
const RUN_STATS = { totalRuns: 3, totalBiocharKg: 120 };
const CREDIT_BATCH = { id: "33333333-3333-4333-8333-333333333333" };

function post(path: string, body?: unknown): Request {
  return new Request(`https://app.example${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function facilityParams(facilityId: string) {
  return { params: Promise.resolve({ facilityId }) };
}

interface ReadEndpoint {
  /** A request that succeeds once the data-access mocks are arranged. */
  ok: () => Promise<Response>;
  /** The data the arranged read answers with, as JSON. */
  data: unknown;
  /** A request whose input cannot be validated; absent when the read takes none. */
  badInput?: () => Promise<Response>;
  badInputError?: string;
  /** A request naming a facility outside the active organization. */
  foreignFacility?: () => Promise<Response>;
  /** The data-access call a foreign facility must never reach. */
  guardedRead?: () => ReturnType<typeof vi.fn>;
}

const endpoints: Record<string, ReadEndpoint> = {
  "facility detail": {
    ok: () => facilityRoute(post("/api/reads/facilities"), facilityParams(FACILITY_ID)),
    data: { id: FACILITY_ID },
    badInput: () => facilityRoute(post("/api/reads/facilities"), facilityParams(MALFORMED_ID)),
    badInputError: "Invalid facility identifier: Choose a valid facility.",
  },
  "active organization": {
    ok: () => activeOrganizationRoute(),
    data: { id: ORG_CONTEXT.organizationId },
  },
  "onboarding status": {
    ok: () => onboardingRoute(post("/api/reads/onboarding/status", { facilityId: FACILITY_ID })),
    data: { facilityCount: 1 },
    badInput: () => onboardingRoute(post("/api/reads/onboarding/status", { facilityId: MALFORMED_ID })),
    badInputError: "Invalid onboarding filters: Choose a valid facility.",
  },
  "dashboard overview": {
    ok: () => dashboardRoute(post("/api/reads/dashboard/overview", { facilityId: FACILITY_ID })),
    data: { generatedAt: "2026-09-15T10:00:00.000Z" },
    badInput: () => dashboardRoute(post("/api/reads/dashboard/overview", { facilityId: MALFORMED_ID })),
    badInputError: "Invalid dashboard filters: Choose a valid facility.",
    foreignFacility: () => dashboardRoute(post("/api/reads/dashboard/overview", { facilityId: FOREIGN_FACILITY_ID })),
    guardedRead: () => mocks.getDashboardOverview,
  },
  facilities: {
    ok: () => facilitiesRoute(post("/api/reads/facilities", { pageSize: 20 })),
    data: EMPTY_PAGE,
    badInput: () =>
      facilitiesRoute(
        post("/api/reads/facilities", { search: TOO_LONG_SEARCH }),
      ),
    badInputError:
      "Invalid facility filters: Search query must be less than 255 characters.",
  },
  "production runs": {
    ok: () =>
      productionRunsRoute(
        post("/api/reads/production-runs", { facilityId: FACILITY_ID }),
      ),
    data: EMPTY_PAGE,
    badInput: () =>
      productionRunsRoute(
        post("/api/reads/production-runs", { startDate: null }),
      ),
    badInputError: "Invalid production run filters: Enter a valid date.",
    foreignFacility: () =>
      productionRunsRoute(
        post("/api/reads/production-runs", { facilityId: FOREIGN_FACILITY_ID }),
      ),
    guardedRead: () => mocks.getProductionRuns,
  },
  "production run stats": {
    ok: () =>
      productionRunStatsRoute(
        post("/api/reads/production-runs/stats", FACILITY_ID),
      ),
    data: RUN_STATS,
    badInput: () =>
      productionRunStatsRoute(
        post("/api/reads/production-runs/stats", MALFORMED_ID),
      ),
    badInputError: "Invalid facility identifier: Choose a valid facility.",
    foreignFacility: () =>
      productionRunStatsRoute(
        post("/api/reads/production-runs/stats", FOREIGN_FACILITY_ID),
      ),
    guardedRead: () => mocks.getProductionRunStats,
  },
  "credit batches": {
    ok: () => creditBatchesRoute(post("/api/reads/credit-batches", FACILITY_ID)),
    data: [CREDIT_BATCH],
    badInput: () =>
      creditBatchesRoute(post("/api/reads/credit-batches", MALFORMED_ID)),
    badInputError: "Invalid facility identifier: Choose a valid facility.",
    foreignFacility: () =>
      creditBatchesRoute(post("/api/reads/credit-batches", FOREIGN_FACILITY_ID)),
    guardedRead: () => mocks.getCreditBatches,
  },
  "facility certifier summary": {
    ok: () =>
      certifierSummaryRoute(
        post(`/api/reads/facilities/${FACILITY_ID}/certifier-summary`),
        facilityParams(FACILITY_ID),
      ),
    data: {
      mapping: null,
      linkedFacilityCount: 0,
      isProduction: false,
      viewerCanManage: false,
    },
    badInput: () =>
      certifierSummaryRoute(
        post(`/api/reads/facilities/${MALFORMED_ID}/certifier-summary`),
        facilityParams(MALFORMED_ID),
      ),
    badInputError: "Invalid facility identifier: Choose a valid facility.",
    foreignFacility: () =>
      certifierSummaryRoute(
        post(`/api/reads/facilities/${FOREIGN_FACILITY_ID}/certifier-summary`),
        facilityParams(FOREIGN_FACILITY_ID),
      ),
    guardedRead: () => mocks.getCertifierProjectByFacility,
  },
};

describe.each(Object.entries(endpoints))(
  "private read route: %s",
  (_name, endpoint) => {
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.resolveOrgContext.mockResolvedValue({ ok: true, ctx: ORG_CONTEXT });
      mocks.requireOrgFacility.mockResolvedValue(undefined);
      mocks.getFacilities.mockResolvedValue(EMPTY_PAGE);
      mocks.getFacilityById.mockResolvedValue({ id: FACILITY_ID });
      mocks.getActiveOrganization.mockResolvedValue({ id: ORG_CONTEXT.organizationId });
      mocks.getOnboardingStatus.mockResolvedValue({ facilityCount: 1 });
      mocks.getDashboardOverview.mockResolvedValue({ generatedAt: "2026-09-15T10:00:00.000Z" });
      mocks.getProductionRuns.mockResolvedValue(EMPTY_PAGE);
      mocks.getProductionRunStats.mockResolvedValue(RUN_STATS);
      mocks.getCreditBatches.mockResolvedValue([CREDIT_BATCH]);
      mocks.getCertifierProjectByFacility.mockResolvedValue(null);
      mocks.listFacilitiesLinkedToExternal.mockResolvedValue([]);
    });

    it("answers 200 with a private ActionResult envelope", async () => {
      const response = await endpoint.ok();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toContain("Cookie");
      await expect(response.json()).resolves.toEqual({
        success: true,
        data: endpoint.data,
      });
    });

    it("answers 401 when the caller is signed out", async () => {
      mocks.resolveOrgContext.mockResolvedValue({
        ok: false,
        denial: "unauthenticated",
      });

      const response = await endpoint.ok();

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: "Sign in to continue.",
      });
      expect(mocks.requireOrgFacility).not.toHaveBeenCalled();
    });

    it("answers 403 when the active organization is not the caller's", async () => {
      mocks.resolveOrgContext.mockResolvedValue({
        ok: false,
        denial: "no-organization",
      });

      const response = await endpoint.ok();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: "Select an Organization to continue.",
      });
      expect(mocks.requireOrgFacility).not.toHaveBeenCalled();
    });

    it.runIf(endpoint.badInput)("answers 400 for input it cannot validate", async () => {
      const response = await endpoint.badInput!();

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: endpoint.badInputError,
      });
      expect(mocks.logger.error).not.toHaveBeenCalled();
    });

    it.runIf(endpoint.foreignFacility)(
      "refuses a facility outside the active organization before reading",
      async () => {
        mocks.requireOrgFacility.mockRejectedValue(
          new SafeError("Facility not found in this organization"),
        );

        const response = await endpoint.foreignFacility!();

        // The guard cannot say whether the facility is missing or simply
        // another organization's, so it answers as a rejected input rather
        // than confirming the row exists.
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          success: false,
          error: "Facility was not found in this Organization.",
        });
        expect(mocks.requireOrgFacility).toHaveBeenCalledWith(
          ORG_CONTEXT,
          FOREIGN_FACILITY_ID,
        );
        expect(endpoint.guardedRead!()).not.toHaveBeenCalled();
      },
    );
  },
);

describe("private read route: malformed body", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOrgContext.mockResolvedValue({ ok: true, ctx: ORG_CONTEXT });
  });

  it("answers 400 without reaching the read model", async () => {
    const response = await facilitiesRoute(
      new Request("https://app.example/api/reads/facilities", {
        method: "POST",
        body: "<html>504 Gateway Timeout</html>",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "The request could not be read. Refresh the page and try again.",
    });
    expect(mocks.getFacilities).not.toHaveBeenCalled();
  });
});

describe("startup read contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOrgContext.mockResolvedValue({ ok: true, ctx: ORG_CONTEXT });
    mocks.requireOrgFacility.mockResolvedValue(undefined);
  });

  it("preserves the scoped facility lookup's missing-row response", async () => {
    mocks.getFacilityById.mockRejectedValueOnce(new SafeError("Facility not found"));
    const response = await facilityRoute(post("/api/reads/facilities"), facilityParams(FOREIGN_FACILITY_ID));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: "Facility was not found." });
    expect(mocks.getFacilityById).toHaveBeenCalledWith(ORG_CONTEXT, FOREIGN_FACILITY_ID);
  });

  it("reads organization-wide onboarding without a facility guard", async () => {
    await onboardingRoute(post("/api/reads/onboarding/status", { facilityId: null }));
    expect(mocks.requireOrgFacility).not.toHaveBeenCalled();
    expect(mocks.getOnboardingStatus).toHaveBeenCalledWith(ORG_CONTEXT, null);
  });

  it("defaults the dashboard range to month", async () => {
    await dashboardRoute(post("/api/reads/dashboard/overview", { facilityId: FACILITY_ID }));
    expect(mocks.getDashboardOverview).toHaveBeenCalledWith(ORG_CONTEXT, FACILITY_ID, "month");
  });

  it("rejects an unsupported dashboard range before data access", async () => {
    const response = await dashboardRoute(post("/api/reads/dashboard/overview", { facilityId: FACILITY_ID, range: "year" }));
    expect(response.status).toBe(400);
    expect(mocks.getDashboardOverview).not.toHaveBeenCalled();
  });

  it("answers a schema mismatch as a logged server fault with its own message", async () => {
    mocks.getDashboardOverview.mockRejectedValueOnce({ cause: { code: "42703" } });
    const response = await dashboardRoute(post("/api/reads/dashboard/overview", { facilityId: FACILITY_ID }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ success: false, error: DASHBOARD_SCHEMA_MISMATCH_MESSAGE });
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ op: "read:dashboard:overview", knownFault: true }),
      "authenticated read failed",
    );
  });
});
