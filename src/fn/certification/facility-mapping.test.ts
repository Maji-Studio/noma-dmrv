import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrgContext } from "@/lib/auth/server";
import { requireOrgFacility } from "@/data-access/utils";
import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import {
  getCertifierProjectByFacility,
  listAllFacilitiesLinkedByProvider,
} from "@/data-access/certification";
import { IsometricApiError, listProjects } from "@/lib/isometric";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { env } from "@/config/env";
import { loadFacilityCertifierMapping, saveFacilityCertifierMapping } from "./facility-mapping";

vi.mock("@/lib/auth/server", () => ({ requireOrgContext: vi.fn(), requireOrgRole: vi.fn() }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn() }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: vi.fn(async () => ({})) }));
vi.mock("@/data-access/certification", () => ({
  getCertifierProjectByFacility: vi.fn(),
  listAllFacilitiesLinkedByProvider: vi.fn(),
  upsertCertifierProject: vi.fn(),
}));
vi.mock("@/lib/isometric", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/isometric")>(),
  listProjects: vi.fn(),
}));
vi.mock("./shared", () => ({ ISOMETRIC_PROVIDER: "isometric", safeListIfConfigured: vi.fn() }));

const ctx = makeTestOrgContext();
const facilityId = "00000000-0000-4000-8000-000000000001";
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, "error").mockImplementation(() => {});
  vi.mocked(requireOrgContext).mockResolvedValue(ctx);
  vi.mocked(requireOrgFacility).mockResolvedValue(undefined);
  vi.mocked(getCertifierProjectByFacility).mockResolvedValue(null);
  vi.mocked(listAllFacilitiesLinkedByProvider).mockResolvedValue([]);
  vi.mocked(listProjects).mockResolvedValue([]);
});

describe("loadFacilityCertifierMapping project listing", () => {
  it.each([HTTP_UNAUTHORIZED, HTTP_FORBIDDEN])("returns a safe refusal code for HTTP %s", async (status) => {
    vi.mocked(listProjects).mockRejectedValueOnce(new IsometricApiError("Private upstream detail", status, undefined, "http"));
    const result = await loadFacilityCertifierMapping(facilityId);
    expect(result).toMatchObject({
      success: false,
      code: "registry_read_refused",
      error: "Isometric refused the saved keys. Replace them in Settings, Registry.",
    });
    expect(requireOrgFacility).toHaveBeenCalledExactlyOnceWith(ctx, facilityId);
    expect(getCertifierProjectByFacility).toHaveBeenCalledWith(ctx, facilityId, "isometric");
    expect(listAllFacilitiesLinkedByProvider).toHaveBeenCalledWith(ctx, "isometric");
  });

  it.each([
    new IsometricApiError("Private server detail", HTTP_SERVER_ERROR, undefined, "http"),
    new IsometricApiError("Private rate limit detail", HTTP_TOO_MANY_REQUESTS, undefined, "http"),
    new IsometricApiError("Private missing resource detail", HTTP_NOT_FOUND, undefined, "http"),
    new IsometricApiError("Private network detail", undefined, undefined, "network"),
    new Error("Private unexpected failure"),
  ])("keeps other failures generic: %s", async (error) => {
    vi.mocked(listProjects).mockRejectedValueOnce(error);
    const result = await loadFacilityCertifierMapping(facilityId);
    expect(result).toEqual({ success: false, error: "The action could not be completed. Try again." });
    expect(result).not.toHaveProperty("code", "registry_read_refused");
  });

  it("keeps missing configuration as an unconfigured success", async () => {
    vi.mocked(listProjects).mockRejectedValueOnce(new IsometricApiError("No keys", undefined, undefined, "not_configured"));
    expect(await loadFacilityCertifierMapping(facilityId)).toMatchObject({
      success: true,
      data: { isConfigured: false, availableProjects: [] },
    });
  });

  it("treats a configured account with no projects as configured", async () => {
    expect(await loadFacilityCertifierMapping(facilityId)).toMatchObject({
      success: true,
      data: { isConfigured: true, availableProjects: [] },
    });
  });

  it("checks facility ownership before resolving the client or listing projects", async () => {
    vi.mocked(requireOrgFacility).mockRejectedValueOnce(new SafeError("Facility not found."));
    expect(await loadFacilityCertifierMapping(facilityId)).toMatchObject({ success: false });
    expect(resolveIsometricClient).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
  });
});

describe("saveFacilityCertifierMapping refusals", () => {
  const input = {
    facilityId,
    externalProjectId: "prj_1",
    protocolSlug: "biochar",
    externalFacilityId: "fcl_12345",
    confirmProduction: false,
  };

  it("files the production confirmation at the confirmation field", async () => {
    const message = "Confirm you want to save against the production Isometric environment.";
    const spy = vi.spyOn(env, "ISOMETRIC_ENVIRONMENT", "get").mockReturnValue("production");
    try {
      expect(await saveFacilityCertifierMapping(input)).toEqual({
        success: false,
        error: message,
        code: "validation_failed",
        issues: [{ path: ["confirmProduction"], code: "validation_failed", message }],
      });
      expect(listProjects).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
