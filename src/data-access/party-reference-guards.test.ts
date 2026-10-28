import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { lockActiveFacilityReference } from "./facility-reference-guards";
import { lockCustomerLocationReference, lockLocationFacilities, lockPartyFacilities } from "./party-reference-guards";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./utils", () => ({ requireOrgScope: vi.fn() }));
vi.mock("./facility-reference-guards", () => ({ lockActiveFacilityReference: vi.fn() }));
const ctx = { organizationId: "org" } as OrgContext;
const tx = {} as DbTransaction;
const pair = (facilityId: string, distanceKm: number | null = 10) => ({ facilityId, distanceKm, distanceSource: "manual" as const });
beforeEach(() => { vi.mocked(lockActiveFacilityReference).mockReset(); });

describe("location facility references", () => {
  it("skips clears, deduplicates and locks in facility id order", async () => {
    await lockLocationFacilities(ctx, tx, [pair("z"), pair("missing", null), pair("a"), pair("z")], []);
    expect(vi.mocked(lockActiveFacilityReference).mock.calls).toEqual([[ctx, tx, "a"], [ctx, tx, "z"]]);
  });
  it.each([{ prefix: [] }, { prefix: ["locations", 2] }])("keeps the original pair index with prefix $prefix", async ({ prefix }) => {
    vi.mocked(lockActiveFacilityReference).mockRejectedValue(new SafeError("Facility not found or archived"));
    await expect(lockLocationFacilities(ctx, tx, [pair("clear", null), pair("z"), pair("a")], prefix))
      .rejects.toMatchObject({ code: "not_found", issues: [{ path: [...prefix, "facilityDistances", 2, "facilityId"] }] });
  });
  it("locks retained promotion pairs in the same pass and points them at the retained pointer", async () => {
    await lockLocationFacilities(ctx, tx, [pair("m"), pair("cleared", null)], [], { facilityIds: ["b", "m", "cleared"], pointer: ["isDefault"] });
    expect(vi.mocked(lockActiveFacilityReference).mock.calls).toEqual([[ctx, tx, "b"], [ctx, tx, "m"]]);
    vi.mocked(lockActiveFacilityReference).mockReset();
    vi.mocked(lockActiveFacilityReference).mockRejectedValue(new SafeError("Facility not found or archived"));
    await expect(lockLocationFacilities(ctx, tx, [pair("m")], [], { facilityIds: ["b"], pointer: ["isDefault"] }))
      .rejects.toMatchObject({ code: "not_found", issues: [{ path: ["isDefault"] }] });
  });
  it("keeps location and pair indices on party creates", async () => {
    vi.mocked(lockActiveFacilityReference).mockRejectedValue(new SafeError("Facility not found or archived"));
    await expect(lockPartyFacilities(ctx, tx, [{ facilityDistances: [pair("clear", null)] }, { facilityDistances: [pair("clear", null), pair("a")] }]))
      .rejects.toMatchObject({ issues: [{ path: ["locations", 1, "facilityDistances", 1, "facilityId"] }] });
  });
});

describe("customer location references", () => {
  function referenceTx(rows: unknown[]) {
    const query = { from: () => query, where: () => query, for: vi.fn().mockResolvedValue(rows) };
    return { tx: { select: () => query } as unknown as DbTransaction, query };
  }
  it("keeps the existing missing destination refusal", async () => {
    const { tx } = referenceTx([]);
    await expect(lockCustomerLocationReference(ctx, tx, "missing")).rejects.toMatchObject({
      code: "not_found", message: "Customer location was not found.", issues: [{ path: ["customerLocationId"], code: "not_found", message: "Customer location was not found." }],
    });
  });
  it("refuses archived destinations at the supplied pointer", async () => {
    const { tx } = referenceTx([{ customerId: "customer", name: "North Block", archivedAt: new Date() }]);
    await expect(lockCustomerLocationReference(ctx, tx, "site", { pointer: ["destination"] })).rejects.toMatchObject({
      code: "not_found", message: "Customer location North Block is archived. Restore it or choose another location.",
      issues: [expect.objectContaining({ path: ["destination"] })],
    });
  });
  it.each([null, new Date()])("holds a kept destination through commit (%s)", async archivedAt => {
    const row = { customerId: "customer", name: "North Block", archivedAt };
    const { tx, query } = referenceTx([row]);
    expect(await lockCustomerLocationReference(ctx, tx, "site", { allowArchived: true })).toEqual(row);
    expect(query.for).toHaveBeenCalledWith("key share");
  });
});
