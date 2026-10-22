import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/auth/providers/better-auth-server", () => ({
  getBetterAuthSession: vi.fn(),
  mapBetterAuthUser: vi.fn(),
  signOut: vi.fn(),
}));

import { renameActiveOrganization } from "@/data-access/organizations";

const ctx: OrgContext = {
  userId: "rename-test-user", organizationId: "rename-test-org",
  orgRole: "admin", isPlatformAdmin: false,
};
const MAX_ATTEMPTS = 3;
const slugCollision = () => new Error("Query failed", {
  cause: { code: "23505", constraint: "organizations_slug_unique" },
});

function transactionAttempt(occupied: string[], failure?: Error) {
  const readCurrent = vi.fn().mockResolvedValue([{ slug: "old-name" }]);
  const readOccupied = vi.fn().mockResolvedValue(occupied.map((slug) => ({ slug })));
  const select = vi.fn()
    .mockReturnValueOnce({ from: () => ({ where: () => ({ for: readCurrent }) }) })
    .mockReturnValueOnce({ from: () => ({ where: readOccupied }) });
  const set = vi.fn((values: { name: string; slug: string }) => ({
    where: () => ({ returning: async () => {
      if (failure) throw failure;
      return [values];
    } }),
  }));
  const tx = { select, update: () => ({ set }) };
  return { tx, set, readCurrent, readOccupied };
}

describe("organization rename retry", () => {
  beforeEach(() => {
    mocks.transaction.mockReset();
  });

  it("re-reads and chooses a new candidate after a unique violation", async () => {
    const first = transactionAttempt([], slugCollision());
    const second = transactionAttempt(["new-name"]);
    mocks.transaction
      .mockImplementationOnce((run) => run(first.tx))
      .mockImplementationOnce((run) => run(second.tx));
    expect(await renameActiveOrganization(ctx, { name: "New name" }))
      .toEqual({ name: "New name", slug: "new-name-2" });
    expect(first.set).toHaveBeenCalledWith({ name: "New name", slug: "new-name" });
    expect(second.readCurrent).toHaveBeenCalledOnce();
    expect(second.readOccupied).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("stops after three colliding attempts", async () => {
    mocks.transaction.mockImplementation((run) => run(transactionAttempt([], slugCollision()).tx));
    await expect(renameActiveOrganization(ctx, { name: "New name" }))
      .rejects.toThrow("Couldn't rename the organization. Try again.");
    expect(mocks.transaction).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it.each([
    new Error("Connection failed"),
    Object.assign(new Error("Other unique constraint"), { code: "23505", constraint: "other_unique" }),
  ])("does not retry unrelated failures", async (error) => {
    mocks.transaction.mockImplementation((run) => run(transactionAttempt([], error).tx));
    await expect(renameActiveOrganization(ctx, { name: "New name" })).rejects.toBe(error);
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
});
