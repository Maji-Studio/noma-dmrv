import { expect, it } from "vitest";
import { isLastAdminDatabaseError, LAST_ADMIN_MESSAGE, rethrowLastAdmin } from "@/lib/auth/organization-role-policy";

it("recognizes direct and wrapped last-Admin check violations", () => {
  const error = { code: "23514", constraint: "members_last_admin" };
  expect(isLastAdminDatabaseError(error)).toBe(true);
  expect(isLastAdminDatabaseError({ cause: error })).toBe(true);
  expect(() => rethrowLastAdmin({ cause: error })).toThrow(LAST_ADMIN_MESSAGE);
});

it("does not relabel other database failures or loop on cyclic causes", () => {
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  for (const error of [
    { code: "23514", constraint: "other_check" },
    { code: "40P01", constraint: "members_last_admin" },
    cycle, null,
  ]) {
    expect(isLastAdminDatabaseError(error)).toBe(false);
    try {
      rethrowLastAdmin(error);
    } catch (caught) {
      expect(caught).toBe(error);
    }
  }
});
