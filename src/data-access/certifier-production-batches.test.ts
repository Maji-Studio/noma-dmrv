import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({
  update: vi.fn(), set: vi.fn(), where: vi.fn(), returning: vi.fn(),
  assertSameOrg: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { update: mocks.update } }));
vi.mock("./utils", async (importOriginal) => ({
  ...await importOriginal<typeof import("./utils")>(),
  assertSameOrg: mocks.assertSameOrg,
}));
import {
  replaceMissingProductionBatchRegistration,
  type CertifierProductionBatchRow,
} from "./certifier-production-batches";

const ctx: OrgContext = { organizationId: "org-current", userId: "user-1", orgRole: "admin", isPlatformAdmin: false };
const expected: CertifierProductionBatchRow = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "org-other", provider: "isometric",
  creditBatchId: "22222222-2222-4222-8222-222222222222",
  externalProductionBatchId: "ptb_old", supplierReference: "nm-ptb-ref",
  externalProjectId: "prj_old", externalFacilityId: "fcl_old",
  massKg: 100, startedOn: "2026-03-01", endedOn: "2026-03-02", payloadHash: "old-hash",
  createdAt: new Date("2026-03-03T00:00:00Z"), updatedAt: new Date("2026-03-03T00:00:00Z"),
};
const replacement = { ...expected, externalProductionBatchId: "ptb_new" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockReturnValue({ set: mocks.set });
  mocks.set.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockResolvedValue([]);
});

describe("replaceMissingProductionBatchRegistration", () => {
  it("scopes CAS to the caller organization and complete observed identity", async () => {
    expect(await replaceMissingProductionBatchRegistration(ctx, expected, replacement)).toBeNull();
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0] as SQL);
    expect(query.sql).toContain('"organization_id" =');
    expect(query.params).toContain(ctx.organizationId);
    expect(query.params).not.toContain(expected.organizationId);
    for (const value of ["isometric", expected.creditBatchId, expected.id, "ptb_old", "old-hash", "fcl_old", "prj_old"]) {
      expect(query.params).toContain(value);
    }
    expect(query.sql).toContain("date_trunc('milliseconds'");
    expect(mocks.assertSameOrg).toHaveBeenCalledWith(ctx, expect.anything(), expected.creditBatchId);
    expect(mocks.set.mock.calls[0][0]).not.toHaveProperty("organizationId");
  });

  it("requires organization scope before writing", async () => {
    await expect(replaceMissingProductionBatchRegistration({ ...ctx, organizationId: "" }, expected, replacement)).rejects.toThrow("Unauthorized");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns the confirmed replacement only when the CAS updated a row", async () => {
    mocks.returning.mockResolvedValue([replacement]);
    expect(await replaceMissingProductionBatchRegistration(ctx, expected, replacement)).toEqual(replacement);
  });
});
