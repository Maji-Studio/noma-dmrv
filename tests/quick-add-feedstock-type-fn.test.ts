import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ create: vi.fn(), ctx: { userId: "test-user", organizationId: "test-org", orgRole: "admin", isPlatformAdmin: false } }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: async () => mocks.ctx }));
vi.mock("@/data-access/feedstock-types", () => ({ createFeedstockTypeInTransaction: mocks.create }));
vi.mock("@/lib/operations/runner", () => ({
  runOperationInProcess: async (operation: { execute: (scope: unknown, input: unknown) => Promise<unknown> }, ctx: unknown, input: unknown) => operation.execute({ ctx, tx: "transaction" }, input),
}));
vi.mock("@/data-access/code-generator", () => ({
  CODE_CONFLICT_MESSAGES: { feedstockType: "duplicate" },
  withAutoCodes: async (_ctx: unknown, _prefix: unknown, _table: unknown, _column: unknown, _code: unknown, _count: unknown, create: (codes: string[], tx: unknown) => Promise<unknown>) => create(["FT-TEST"], "savepoint"),
}));
import { createFeedstockTypeFn } from "@/fn/quick-add";
const data = { name: "Selected type", category: "forestry" as const, usage: "pyrolysis" as const, isometricFeedstockTypeId: " ft_selected " };
beforeEach(() => { mocks.create.mockReset(); });
describe("feedstock type quick-add server payload", () => {
  it("passes the validated registry selection and server org context to DAL", async () => {
    const entity = { id: "type-id", code: "FT-TEST", name: data.name, subtitle: "forestry · pyrolysis" };
    mocks.create.mockResolvedValue({ ...entity, category: data.category, usage: data.usage });
    await expect(createFeedstockTypeFn(data)).resolves.toEqual({ success: true, data: entity });
    expect(mocks.create).toHaveBeenCalledWith(mocks.ctx, "savepoint", { ...data, code: "FT-TEST", isometricFeedstockTypeId: "ft_selected" });
  });
  it("returns the canonical permission refusal", async () => {
    mocks.create.mockRejectedValue(new SafeError("You don't have permission to perform this action."));
    await expect(createFeedstockTypeFn(data)).resolves.toEqual({ success: false, error: "You don't have permission to perform this action." });
  });
  it("rejects an invalid registry ID before calling DAL", async () => {
    await expect(createFeedstockTypeFn({ ...data, isometricFeedstockTypeId: "x".repeat(256) })).resolves.toMatchObject({ success: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
