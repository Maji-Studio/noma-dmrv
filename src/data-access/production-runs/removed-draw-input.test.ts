import { describe, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { createProductionRunInTransaction } from "./mutations";

const ctx: OrgContext = { organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false };

describe("explicit production draw inputs", () => {
  it("does not turn obsolete bin and mass properties into a draw", async () => {
    const select = vi.fn()
      .mockReturnValueOnce({ from: () => ({ where: async () => [{ id: "facility", archivedAt: null }] }) })
      .mockReturnValueOnce({ from: () => ({ where: async () => [{ id: "reactor", facilityId: "facility" }] }) });
    const insert = vi.fn();
    const tx = { select, insert } as unknown as DbTransaction;
    const obsolete = { feedstockStorageLocationId: "bin", feedstockWetMassKg: 100 };
    await expect(createProductionRunInTransaction(ctx, tx, {
      ...obsolete,
      code: "PR-TEST", facilityId: "facility", reactorId: "reactor", status: "complete",
      startTime: new Date("2026-01-01T08:00:00Z"), endTime: new Date("2026-01-01T09:00:00Z"),
      feedstockMoisturePercent: 20, biocharOutputKg: 10, biocharMoisturePercent: 5, biocharStorageLocationId: "output",
    })).rejects.toMatchObject({ code: "validation_failed", issues: [expect.objectContaining({ path: ["feedstockDraws"] })] });
    expect(insert).not.toHaveBeenCalled();
  });
});
