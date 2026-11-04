import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFacilityFn } from "./facilities";
import { createReactorFn } from "./reactors";
import { createStorageLocationFn } from "./storage-locations";
import { createFeedstockTypeFn } from "./feedstock-types";
import { startNewProductionProcessFn } from "./production-processes";

const { auth, run, role } = vi.hoisted(() => ({ auth: vi.fn(), run: vi.fn(), role: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: auth, requireOrgRole: role }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: run }));
vi.mock("@/lib/operations/facilities", () => ({ createFacility: { id: "create_facility" } }));
vi.mock("@/lib/operations/reactors", () => ({ createReactor: { id: "create_reactor" } }));
vi.mock("@/lib/operations/storage-locations", () => ({ createStorageLocation: { id: "create_storage_location" } }));
vi.mock("@/lib/operations/feedstock-types", () => ({ createFeedstockType: { id: "create_feedstock_type" } }));
vi.mock("@/lib/operations/production-processes", () => ({ startNewProductionProcess: { id: "start_new_production_process" } }));
vi.mock("@/data-access/facilities", () => ({}));
vi.mock("@/data-access/facility-stats", () => ({}));
vi.mock("@/data-access/facility-output-stock", () => ({}));
vi.mock("@/data-access/reactors", () => ({}));
vi.mock("@/data-access/reactor-stats", () => ({}));
vi.mock("@/data-access/storage-locations", () => ({}));
vi.mock("@/data-access/feedstock-types", () => ({}));
vi.mock("@/data-access/production-processes", () => ({}));
vi.mock("@/data-access/code-generator", () => ({}));
vi.mock("@/data-access/certifier-credentials", () => ({}));
vi.mock("@/data-access/utils", () => ({}));
vi.mock("@/lib/isometric", () => ({}));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() }, sanitizeErrorMessage: vi.fn() }));

const ID = "11111111-1111-4111-8111-111111111111";
const ctx = { userId: ID, organizationId: ID, orgRole: "admin", isPlatformAdmin: false };
const cases = [
  { id: "create_facility", action: createFacilityFn, input: { name: "Facility", country: "CH", gpsLatitude: 0, gpsLongitude: 0, timezone: "UTC" } },
  { id: "create_reactor", action: createReactorFn, input: { identifier: "Reactor", facilityId: ID, reactorType: "batch" } },
  { id: "create_storage_location", action: createStorageLocationFn, input: { name: "Bin", facilityId: ID, type: "biochar_bin" } },
  { id: "create_feedstock_type", action: createFeedstockTypeFn, input: { name: "Type", category: "forestry", usage: "pyrolysis" } },
  { id: "start_new_production_process", action: startNewProductionProcessFn, input: { facilityId: ID, feedstockTypeId: ID } },
];
beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue(ctx);
  run.mockResolvedValue({ id: ID, createdAt: new Date("2026-10-22T00:00:00Z") });
});
describe.each(cases)("$id intent boundary", ({ id, action, input }) => {
  it("forwards the key separately and retains keyless callers", async () => {
    expect(await action(input as never, { intentKey: ID })).toMatchObject({ success: true, data: { createdAt: expect.any(Date) } });
    expect(run).toHaveBeenCalledWith({ id }, ctx, expect.not.objectContaining({ intentKey: ID }), { intentKey: ID });
    expect(await action(input as never)).toMatchObject({ success: true });
    expect(run.mock.calls[1][3]).toBeUndefined();
  });
  it("refuses malformed intent before the writer runs", async () => {
    expect(await action(input as never, { intentKey: "invalid" })).toMatchObject({ success: false, code: "validation_failed" });
    expect(run).not.toHaveBeenCalled();
  });
  it("validates values before the intent", async () => {
    const result = await action({} as never, { intentKey: "invalid" });
    expect(result).toMatchObject({ success: false, code: "validation_failed" });
    if (!result.success) expect(result.issues?.some(issue => issue.path[0] === "intentKey")).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
it("retains the production-process Admin gate before the runner", async () => {
  role.mockImplementationOnce(() => { throw new Error("Denied"); });
  expect(await startNewProductionProcessFn(cases[4].input, { intentKey: ID })).toMatchObject({ success: false });
  expect(role).toHaveBeenCalledWith(ctx, "admin");
  expect(run).not.toHaveBeenCalled();
});
