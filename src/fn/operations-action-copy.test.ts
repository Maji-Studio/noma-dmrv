import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { productionSamples } from "@/db/schema";
import { SafeError, toActionError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  listSamples: vi.fn(),
  listIncidents: vi.fn(),
  createIncident: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.auth }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.log }, sanitizeErrorMessage: vi.fn() }));
vi.mock("@/data-access/utils", () => ({ requireOrgScope: vi.fn(), requireOrgFacility: vi.fn() }));
vi.mock("@/data-access/applications", () => ({ getApplications: mocks.list }));
vi.mock("@/data-access/production-samples", () => ({
  createProductionSample: mocks.create,
  getProductionSamples: mocks.listSamples,
}));
vi.mock("@/data-access/production-incidents", () => ({
  getProductionIncidents: mocks.listIncidents,
  createProductionIncident: mocks.createIncident,
}));
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => [{ maxSuffix: 0 }] }) }) },
}));

import { getApplicationsFn } from "./applications";
import { createProductionIncidentFn, getProductionIncidentsFn } from "./production-incidents";
import { createProductionSampleFn, getProductionSamplesFn } from "./production-samples";

const ID = "33333333-3333-4333-8333-333333333333";
const OVERLONG_SEARCH_LENGTH = 256;
const APPLICATION_LOAD_FAILURE = "Applications could not be loaded. Refresh the page and try again.";
const SAMPLE_CREATE_FAILURE = "In-process measurement was not created. Check the form.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ organizationId: ID, userId: ID, orgRole: "owner", isPlatformAdmin: false });
});

describe("operations action operator copy", () => {
  describe.each([
    {
      entity: "production samples",
      action: getProductionSamplesFn,
      list: mocks.listSamples,
      failure: "In-process measurements could not be loaded. Refresh the page and try again.",
    },
    {
      entity: "production incidents",
      action: getProductionIncidentsFn,
      list: mocks.listIncidents,
      failure: "Production incidents could not be loaded. Refresh the page and try again.",
    },
  ])("$entity list", ({ action, list, failure }) => {
    it("preserves the fixed load message for a data-access SafeError", async () => {
      list.mockRejectedValueOnce(new SafeError("The production run is unavailable."));
      expect(await action(ID)).toEqual({ success: false, error: failure });
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ID }), ID);
      expect(mocks.log).not.toHaveBeenCalled();
    });

    it("returns Invalid input for an invalid run id before data access", async () => {
      expect(await action("non-uuid")).toEqual({ success: false, error: "Invalid input" });
      expect(list).not.toHaveBeenCalled();
      expect(mocks.log).not.toHaveBeenCalled();
    });
  });

  it("preserves the incident create message for a data-access SafeError", async () => {
    mocks.createIncident.mockRejectedValueOnce(new SafeError("The production run is unavailable."));
    expect(await createProductionIncidentFn({
      productionRunId: ID,
      incidentTime: new Date("2026-09-01T12:00:00Z"),
      severity: "low",
      description: "Temperature exceeded the expected range.",
    })).toEqual({
      success: false,
      error: "Production incident was not created. Check the form.",
    });
    expect(mocks.createIncident).toHaveBeenCalledOnce();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it.each([
    { search: "x".repeat(OVERLONG_SEARCH_LENGTH) },
    { creditBatchId: "non-uuid" },
  ])("preserves the applications load message for reachable invalid filters: %j", async (filters) => {
    expect(await getApplicationsFn(filters)).toEqual({ success: false, error: APPLICATION_LOAD_FAILURE });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
    expect(toActionError(new Error(), "Failed to get applications")).toBe(APPLICATION_LOAD_FAILURE);
    expect(new SafeError(APPLICATION_LOAD_FAILURE).message).toBe(APPLICATION_LOAD_FAILURE);
  });

  it("authenticates before checking applications filters", async () => {
    mocks.auth.mockRejectedValueOnce(new SafeError("Sign in to continue."));
    expect(await getApplicationsFn({ creditBatchId: "non-uuid" })).toEqual({
      success: false, error: "Sign in to continue.",
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("retains the sample create message and conflict metadata when generated-code retries exhaust", async () => {
    mocks.create.mockRejectedValue({
      code: "23505",
      constraint: `${getTableName(productionSamples)}_organization_id_${productionSamples.sampleCode.name}_unique`,
    });
    expect(await createProductionSampleFn({ productionRunId: ID, timestamp: "2026-09-01T12:00:00Z" })).toEqual({
      success: false,
      error: SAMPLE_CREATE_FAILURE,
      code: "conflict",
      issues: [{ path: ["code"], code: "conflict", message: SAMPLE_CREATE_FAILURE }],
    });
    expect(mocks.create.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.log).not.toHaveBeenCalled();
  });
});
