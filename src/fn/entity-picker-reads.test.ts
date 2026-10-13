import { beforeEach, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { getFeedstockTypeByIdFn, canManageFeedstockTypesFn } from "./feedstock-types";
import { getReactorByIdFn } from "./reactors";
import { getOrderByIdFn } from "./orders";

const mocks = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: mocks.context,
}));
vi.mock("@/data-access/feedstock-types", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/data-access/feedstock-types")>(), getFeedstockTypeById: mocks.read,
}));
vi.mock("@/data-access/reactors", () => ({ getReactorById: mocks.read }));
vi.mock("@/data-access/orders", () => ({ getOrderById: mocks.read }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn(), child: () => ({ error: vi.fn() }) }, sanitizeErrorMessage: () => "error" }));
const id = "00000000-0000-4000-8000-000000000001";
const ctx: OrgContext = { userId: "user", organizationId: "org", orgRole: "member", isPlatformAdmin: false };
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue(ctx); mocks.read.mockResolvedValue({ id, version: 1 }); });
it.each([getFeedstockTypeByIdFn, getReactorByIdFn, getOrderByIdFn])("validates the id and passes trusted org context to the getter", async (read) => {
  expect(await read("invalid")).toMatchObject({ success: false });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(await read(id)).toMatchObject({ success: true, data: { id } });
  expect(mocks.read).toHaveBeenCalledWith(ctx, id);
});
it.each([
  { orgRole: "member", isPlatformAdmin: false, allowed: false },
  { orgRole: "admin", isPlatformAdmin: false, allowed: true },
  { orgRole: "owner", isPlatformAdmin: false, allowed: true },
  { orgRole: null, isPlatformAdmin: true, allowed: true },
  { orgRole: null, isPlatformAdmin: false, allowed: false },
])("resolves management permission from the session: %s", async ({ orgRole, isPlatformAdmin, allowed }) => {
  mocks.context.mockResolvedValue({ ...ctx, orgRole, isPlatformAdmin });
  expect(await canManageFeedstockTypesFn()).toEqual({ success: true, data: allowed });
});
