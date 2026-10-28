import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import type { OperationScope } from "@/lib/operations/runner";
import { representationCheckedUpdate as customerUpdate, representationCheckedDelete as customerDelete, representationCheckedTransition } from "./customer-location-write-operations";
import { representationCheckedUpdate as supplierUpdate, representationCheckedDelete as supplierDelete } from "./supplier-location-write-operations";

const mocks = vi.hoisted(() => ({ customer: vi.fn(), supplier: vi.fn(), customerLocation: vi.fn(), supplierLocation: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/read-models/api-customers", () => ({ readApiCustomer: mocks.customer }));
vi.mock("@/lib/read-models/api-suppliers", () => ({ readApiSupplier: mocks.supplier }));
vi.mock("@/lib/read-models/api-customer-locations", () => ({ readApiCustomerLocation: mocks.customerLocation }));
vi.mock("@/lib/read-models/api-supplier-locations", () => ({ readApiSupplierLocation: mocks.supplierLocation }));
vi.mock("@/lib/operations/party-location-api", () => {
  const operation = { execute: mocks.write };
  return { updateCustomerLocationApi: operation, deleteCustomerLocationApi: operation, archiveCustomerLocationApi: operation, restoreCustomerLocationApi: operation,
    updateSupplierLocationApi: operation, deleteSupplierLocationApi: operation };
});
const PARENT = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const CHILD = "ea31ace1-5b30-4443-adb4-26b43bfa5599";
const scope = { ctx: { organizationId: "org" }, tx: {} } as OperationScope;
const parent = { id: PARENT, code: "CUS-0003", archivedAt: null };
const location = { id: CHILD, customerId: PARENT, supplierId: PARENT, name: "North Block", version: 2, archivedAt: null };
const staleRevision = 2;
const validRevision = 1;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.customer.mockResolvedValue(parent);
  mocks.supplier.mockResolvedValue({ ...parent, code: "SUP-0003" });
  mocks.customerLocation.mockResolvedValue(location);
  mocks.supplierLocation.mockResolvedValue(location);
  mocks.write.mockRejectedValue(new DomainError("stale_version", "The row has changed."));
});

for (const kind of ["customer", "supplier"] as const) describe(`${kind} child revision ordering`, () => {
  const commands = kind === "customer" ? ["update", "delete", "archive", "restore"] as const : ["update", "delete"] as const;
  const wrap = (command: typeof commands[number], revision: number) => kind === "supplier"
    ? (command === "update" ? supplierUpdate : supplierDelete)(PARENT, CHILD, revision)
    : command === "archive" || command === "restore" ? representationCheckedTransition(PARENT, CHILD, revision, command)
    : (command === "update" ? customerUpdate : customerDelete)(PARENT, CHILD, revision);
  const input = { customerId: PARENT, supplierId: PARENT, locationId: CHILD, expectedVersion: 1, city: "Changed" };
  const readParent = () => mocks[kind];
  const readLocation = () => kind === "customer" ? mocks.customerLocation : mocks.supplierLocation;

  it.each(commands)("%s answers a missing or foreign party at /locationId, as the writer does", async command => {
    readParent().mockRejectedValue(new DomainError("not_found", "Party not found"));
    readLocation().mockResolvedValue(null);
    await expect(wrap(command, staleRevision).execute(scope, input)).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["locationId"] }] });
    expect(readParent()).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(commands)("%s checks missing/foreign/wrong-parent location before archived parent or preconditions", async command => {
    readParent().mockResolvedValue({ ...parent, archivedAt: "2026-10-01T00:00:00Z" });
    readLocation().mockResolvedValue(null);
    await expect(wrap(command, staleRevision).execute(scope, input)).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["locationId"] }] });
    expect(readLocation()).toHaveBeenCalledWith(scope.ctx, PARENT, CHILD, scope.tx);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(commands)("%s checks archived parent before stale revision and row version", async command => {
    readParent().mockResolvedValue({ ...parent, code: kind === "customer" ? "CUS-0003" : "SUP-0003", archivedAt: "2026-10-01T00:00:00Z" });
    readLocation().mockResolvedValue({ ...location, archivedAt: "2026-10-01T00:00:00Z" });
    const message = kind === "customer" ? "Customer CUS-0003 is archived. Restore it before editing it." : "Supplier SUP-0003 is archived. Restore it before editing it.";
    await expect(wrap(command, staleRevision).execute(scope, input)).rejects.toMatchObject({ code: "not_found", message, issues: [{ path: [`${kind}Id`] }] });
    expect(readParent()).toHaveBeenCalledWith(scope.ctx, { id: PARENT }, scope.tx);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(commands)("%s refuses only PATCH of an archived location before stale revision", async command => {
    readLocation().mockResolvedValue({ ...location, archivedAt: "2026-10-01T00:00:00Z" });
    const result = wrap(command, staleRevision).execute(scope, input);
    if (kind === "customer" && command === "update") await expect(result).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["locationId"] }], message: "Customer location North Block is archived. Restore it before editing it." });
    else await expect(result).rejects.toMatchObject({ code: "stale_version", message: "The representation has changed." });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(commands)("%s returns stale revision for an existing editable child even with stale row version", async command => {
    await expect(wrap(command, staleRevision).execute(scope, input)).rejects.toMatchObject({ code: "stale_version", message: "The representation has changed." });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(commands)("%s leaves all ordering to the locked writer on a valid revision", async command => {
    const refused = new DomainError("not_found", "The locked writer decides.");
    mocks.write.mockRejectedValueOnce(refused);
    await expect(wrap(command, validRevision).execute(scope, input)).rejects.toBe(refused);
    await expect(wrap(command, validRevision).execute(scope, input)).rejects.toMatchObject({ code: "stale_version", message: "The row has changed." });
    expect(readParent()).not.toHaveBeenCalled();
    expect(readLocation()).not.toHaveBeenCalled();
    mocks.write.mockResolvedValueOnce({ data: location, warnings: [] });
    await expect(wrap(command, validRevision).execute(scope, input)).resolves.toEqual({ data: location, warnings: [] });
  });
});
