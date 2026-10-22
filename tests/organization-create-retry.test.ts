import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), seed: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/db/org-defaults", () => ({ seedOrgDefaults: mocks.seed }));
vi.mock("@/lib/auth/server", () => ({ requirePlatformAdmin: vi.fn().mockResolvedValue({ id: "platform-admin" }) }));
import { createOrganizationWithAdmin } from "@/data-access/organizations";

const MAX_ATTEMPTS = 3;
const collision = () => new Error("Query failed", {
  cause: { code: "23505", constraint: "organizations_slug_unique" },
});
function attempt(occupied: string[], failure?: Error) {
  const select = vi.fn()
    .mockReturnValueOnce({ from: () => ({ where: async () => occupied.map((slug) => ({ slug })) }) })
    .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ id: "first-admin" }] }) }) });
  const values = vi.fn().mockImplementation(async () => {
    if (failure) throw failure;
  });
  return { tx: { select, insert: () => ({ values }) }, values };
}

describe("organization creation slug retry", () => {
  beforeEach(() => vi.clearAllMocks());
  it("reallocates after a concurrent slug collision and seeds only after success", async () => {
    const first = attempt([], collision());
    const second = attempt(["new-org"]);
    mocks.transaction.mockImplementationOnce((run) => run(first.tx))
      .mockImplementationOnce((run) => run(second.tx));
    expect(await createOrganizationWithAdmin({ name: "New org", adminEmail: "admin@example.test" }))
      .toMatchObject({ name: "New org", firstAdmin: { kind: "member" } });
    expect(first.values).toHaveBeenCalledWith(expect.objectContaining({ slug: "new-org" }));
    expect(second.values).toHaveBeenCalledWith(expect.objectContaining({ slug: "new-org-2" }));
    expect(second.values.mock.calls[0][0].id).toBe(first.values.mock.calls[0][0].id);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.seed).toHaveBeenCalledOnce();
  });
  it("stops after repeated collisions without seeding", async () => {
    mocks.transaction.mockImplementation((run) => run(attempt([], collision()).tx));
    await expect(createOrganizationWithAdmin({ name: "New org", adminEmail: "admin@example.test" }))
      .rejects.toThrow("Couldn't create the organization. Try again.");
    expect(mocks.transaction).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(mocks.seed).not.toHaveBeenCalled();
  });
  it("does not retry unrelated failures", async () => {
    const error = new Error("Connection unavailable");
    mocks.transaction.mockRejectedValue(error);
    await expect(createOrganizationWithAdmin({ name: "New org", adminEmail: "admin@example.test" })).rejects.toBe(error);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.seed).not.toHaveBeenCalled();
  });
});
