import { beforeEach, describe, expect, it, vi } from "vitest";

const dbSpies = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: dbSpies.select,
    transaction: dbSpies.transaction,
  },
}));

import type { OrgContext } from "@/lib/auth/server";
import { createProductionRun, updateProductionRun } from "./mutations";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const FUTURE = new Date("2026-07-15T12:00:00.001Z");
const ctx: OrgContext = {
  userId: "user-test",
  organizationId: "org-test",
  orgRole: "owner",
  isPlatformAdmin: false,
};

beforeEach(() => {
  dbSpies.select.mockReset();
  dbSpies.transaction.mockReset();
});

describe("production-run mutation future-time ordering", () => {
  it("rejects a future create before any database read or transaction", async () => {
    await expect(
      createProductionRun(
        ctx,
        {
          code: "PR-26-001",
          facilityId: "facility-test",
          reactorId: "reactor-test",
          startTime: FUTURE,
          endTime: null,
        },
        { now: NOW },
      ),
    ).rejects.toThrow(
      "Start time cannot be in the future. Enter a time at or before now.",
    );

    expect(dbSpies.select).not.toHaveBeenCalled();
    expect(dbSpies.transaction).not.toHaveBeenCalled();
  });

  it("rejects a submitted future update before loading or mutating the run", async () => {
    await expect(
      updateProductionRun(
        ctx,
        "run-test",
        { endTime: FUTURE },
        { now: NOW },
      ),
    ).rejects.toThrow(
      "End time cannot be in the future. Enter a time at or before now.",
    );

    expect(dbSpies.select).not.toHaveBeenCalled();
    expect(dbSpies.transaction).not.toHaveBeenCalled();
  });
});
