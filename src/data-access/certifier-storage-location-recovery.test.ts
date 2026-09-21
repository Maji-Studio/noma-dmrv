import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { CertifierStorageLocation } from "@/db/schema/certifier-storage-locations";
import { certifierStorageLocations } from "@/db/schema/certifier-storage-locations";
import { certifierBiocharApplications } from "@/db/schema/certifier-biochar-applications";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));

import { replaceMissingStorageLocationRegistration } from "./certifier-storage-locations";

const ctx: OrgContext = {
  organizationId: "org-recovery", userId: "user-recovery",
  orgRole: "admin", isPlatformAdmin: false,
};
const old = {
  id: "registration-1", provider: "isometric", customerLocationId: "site-1",
  certifierProjectId: "mapping-1", externalProjectId: "prj-1",
  externalStorageLocationId: "slc-old", supplierReference: "nm-slc-site",
  payloadHash: "unchanged-hash",
} as CertifierStorageLocation;
const dialect = new PgDialect();

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (fn) => fn({ update: mocks.update }));
});

function updates(rows: CertifierStorageLocation[]) {
  const storageWhere = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(rows) });
  const dependencyWhere = vi.fn().mockResolvedValue(undefined);
  const storageSet = vi.fn().mockReturnValue({ where: storageWhere });
  const dependencySet = vi.fn().mockReturnValue({ where: dependencyWhere });
  mocks.update.mockImplementation((table) => ({
    set: table === certifierStorageLocations ? storageSet : dependencySet,
  }));
  return { storageWhere, dependencyWhere, storageSet, dependencySet };
}

function query(where: ReturnType<typeof vi.fn>) {
  return dialect.sqlToQuery(where.mock.calls[0][0] as SQL);
}

describe("replaceMissingStorageLocationRegistration", () => {
  it("changes only the external identity and flags scoped dependencies without rewriting claim history", async () => {
    const replacement = { ...old, externalStorageLocationId: "slc-new" };
    const calls = updates([replacement]);
    await expect(replaceMissingStorageLocationRegistration(ctx, old, "slc-new")).resolves.toEqual(replacement);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls.map(([table]) => table)).toEqual([
      certifierStorageLocations, certifierBiocharApplications,
    ]);
    expect(Object.keys(calls.storageSet.mock.calls[0][0]).sort()).toEqual([
      "driftDetails", "driftDetectedAt", "driftStatus", "externalStorageLocationId", "updatedAt",
    ]);
    // Neither confirmed nor ambiguous in-flight journals may have their payload,
    // external IDs, lifecycle, or GHG Entry association rewritten by recovery.
    expect(Object.keys(calls.dependencySet.mock.calls[0][0]).sort()).toEqual([
      "correctionStatus", "driftReason", "updatedAt",
    ]);
    expect(calls.dependencySet.mock.calls[0][0]).toMatchObject({
      correctionStatus: "review_required", driftReason: "storage_location_replaced",
    });
    const storage = query(calls.storageWhere);
    expect(storage.sql).toContain('"organization_id" =');
    expect(storage.sql).toContain('"external_storage_location_id" =');
    expect(storage.params).toEqual([
      ctx.organizationId, old.id, old.provider, old.customerLocationId,
      old.certifierProjectId, old.externalProjectId, old.externalStorageLocationId,
      old.supplierReference, old.payloadHash,
    ]);
    const dependencies = query(calls.dependencyWhere);
    expect(dependencies.sql).toContain('"organization_id" =');
    expect(dependencies.params).toEqual([ctx.organizationId, old.provider, old.id, "slc-old"]);
  });

  it("does not flag dependencies when another writer has replaced the expected identity", async () => {
    const calls = updates([]);
    await expect(replaceMissingStorageLocationRegistration(ctx, old, "slc-new")).resolves.toBeNull();
    expect(calls.dependencySet).not.toHaveBeenCalled();
  });

  it("propagates dependency write failure to the enclosing transaction", async () => {
    const calls = updates([{ ...old, externalStorageLocationId: "slc-new" }]);
    calls.dependencyWhere.mockRejectedValue(new Error("journal write failed"));
    await expect(replaceMissingStorageLocationRegistration(ctx, old, "slc-new")).rejects.toThrow("journal write failed");
  });

  it("rejects missing organization scope before opening a transaction", async () => {
    await expect(replaceMissingStorageLocationRegistration({ ...ctx, organizationId: "" }, old, "slc-new")).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
