import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";
const mocks = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/log")>();
  return { ...actual, logger: { ...actual.logger, error: mocks.log } };
});
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: async () => ({ organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false }) }));
vi.mock("@/data-access/production-incidents", () => ({ updateProductionIncident: mocks.update, deleteProductionIncident: mocks.remove }));
vi.mock("@/data-access/production-samples", () => ({ updateProductionSample: mocks.update, deleteProductionSample: mocks.remove }));
vi.mock("@/data-access/biochar-products", () => ({ updateBiocharProduct: mocks.update, deleteBiocharProduct: mocks.remove }));
import { updateProductionIncidentFn, deleteProductionIncidentFn } from "./production-incidents";
import { updateProductionSampleFn, deleteProductionSampleFn } from "./production-samples";
import { updateBiocharProductFn, deleteBiocharProductFn } from "./biochar-products";
const ID = "33333333-3333-4333-8333-333333333333";
const VERSION = 1;
const cases = [
  { entity: "productionIncident", update: updateProductionIncidentFn, remove: deleteProductionIncidentFn,
    data: { productionIncidentId: ID, productionRunId: ID, incidentTime: new Date("2026-09-01T12:00:00Z"), description: "Incident", severity: "low" as const, expectedVersion: VERSION } },
  { entity: "productionSample", update: updateProductionSampleFn, remove: deleteProductionSampleFn,
    data: { productionSampleId: ID, productionRunId: ID, timestamp: "2026-09-01T12:00:00Z", expectedVersion: VERSION } },
  { entity: "biocharProduct", update: updateBiocharProductFn, remove: deleteBiocharProductFn,
    data: { productId: ID, expectedVersion: VERSION } },
];
beforeEach(() => vi.clearAllMocks());
describe.each(cases)("$entity actions", entry => {
  it.each(["update", "remove"] as const)("preserves the %s failure log", async action => {
    mocks[action].mockRejectedValueOnce(new Error("connection reset"));
    const result = await entry[action](entry.data as never);
    const op = action === "remove" ? "delete" : "update";
    const message = entry.entity === "biocharProduct"
      ? "biochar product action failed"
      : `${op}${entry.entity[0].toUpperCase()}${entry.entity.slice(1)}Fn failed`;
    expect(result.success).toBe(false);
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith(
      entry.entity === "biocharProduct"
        ? expect.objectContaining({ op: `biochar-product:${op}` })
        : expect.objectContaining({ errorName: "Error" }),
      message,
    );
  });
  it.each(["update", "remove"] as const)("preserves the %s version refusal", async action => {
    const conflict = { entity: entry.entity, id: ID, code: STALE_VERSION_CONFLICT_CODE };
    mocks[action].mockRejectedValueOnce(new DomainError("stale_version", STALE_VERSION_MESSAGE, { conflict }));
    const result = await entry[action](entry.data as never);
    expect(result).toEqual({ success: false, error: STALE_VERSION_MESSAGE, code: "stale_version", conflict });
    if (action === "update") expect(mocks.update).toHaveBeenCalledWith(expect.anything(), ID, expect.objectContaining({ expectedVersion: VERSION }));
    else expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), ID, VERSION);
  });
});
