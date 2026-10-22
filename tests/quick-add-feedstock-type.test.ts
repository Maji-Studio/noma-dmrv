import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { feedstockTypes, organizations } from "@/db/schema";
import { createFeedstockType } from "@/lib/operations/feedstock-types";
import { runOperationInProcess } from "@/lib/operations/runner";
import { createFeedstockTypeFn } from "@/fn/quick-add";
import * as auth from "@/lib/auth/server";
import * as canonical from "@/data-access/feedstock-types";
import { makeTestOrgContext, ensureTestOrg } from "./helpers/test-org";

const names: string[] = [];
beforeAll(() => ensureTestOrg());
afterEach(async () => {
  if (names.length) await db.delete(feedstockTypes).where(inArray(feedstockTypes.name, names.splice(0)));
});
function input() {
  const name = `FT-AUDIT-${crypto.randomUUID()}`;
  names.push(name);
  return { name, category: "forestry" as const, usage: "pyrolysis" as const, isometricFeedstockTypeId: `ft_${crypto.randomUUID()}` };
}

describe("feedstock type quick-add canonical policy", () => {
  it("rejects Members through the real canonical DAL without inserting", async () => {
    const data = input();
    const spy = vi.spyOn(canonical, "createFeedstockTypeInTransaction");
    await expect(runOperationInProcess(createFeedstockType, { ...makeTestOrgContext(), orgRole: "member" }, data))
      .rejects.toThrow("permission");
    expect(spy).toHaveBeenCalledOnce();
    expect(await db.select().from(feedstockTypes).where(eq(feedstockTypes.name, data.name))).toEqual([]);
  });

  it.each(["admin"] as const)("allows %s and persists registry selection with EntityOption", async (orgRole) => {
    const data = input();
    const ctx = { ...makeTestOrgContext(), orgRole };
    const spy = vi.spyOn(canonical, "createFeedstockTypeInTransaction");
    vi.spyOn(auth, "requireOrgContext").mockResolvedValue(ctx);
    const response = await createFeedstockTypeFn({ ...data, name: ` ${data.name} ` });
    expect(response.success).toBe(true);
    if (!response.success) throw new Error(response.error);
    const result = response.data;
    expect(spy).toHaveBeenCalledWith(ctx, expect.anything(), expect.objectContaining({ isometricFeedstockTypeId: data.isometricFeedstockTypeId }));
    expect(result).toEqual({ id: expect.any(String), code: expect.stringMatching(/^FT-\d{2}-\d{3,}$/), name: data.name, subtitle: "forestry · pyrolysis" });
    const [saved] = await db.select().from(feedstockTypes).where(eq(feedstockTypes.id, result.id));
    expect(saved).toMatchObject({ organizationId: ctx.organizationId, isometricFeedstockTypeId: data.isometricFeedstockTypeId });
  });

  it("maps a duplicate registry selection to an actionable safe error", async () => {
    const data = input();
    const duplicate = input();
    const ctx = makeTestOrgContext();
    await runOperationInProcess(createFeedstockType, ctx, data);
    await expect(runOperationInProcess(createFeedstockType, ctx, { ...duplicate, isometricFeedstockTypeId: data.isometricFeedstockTypeId }))
      .rejects.toMatchObject({ name: "SafeError", message: "This Isometric feedstock type already exists. Select the existing feedstock type." });
    expect(await db.select().from(feedstockTypes).where(eq(feedstockTypes.name, duplicate.name))).toEqual([]);
  });

  it("keeps duplicate name/usage handling scoped to the active organization", async () => {
    const data = input();
    const duplicate = input();
    const ctx = makeTestOrgContext();
    const otherOrgId = `org-audit-${crypto.randomUUID()}`;
    await db.insert(organizations).values({ id: otherOrgId, name: otherOrgId, slug: otherOrgId });
    try {
      await runOperationInProcess(createFeedstockType, ctx, data);
      await expect(runOperationInProcess(createFeedstockType, ctx, { ...duplicate, name: ` ${data.name} ` })).rejects.toThrow("name and usage already exists");
      await expect(runOperationInProcess(createFeedstockType, { ...ctx, organizationId: otherOrgId }, data)).resolves.toMatchObject({ name: data.name });
    } finally {
      await db.delete(feedstockTypes).where(eq(feedstockTypes.organizationId, otherOrgId));
      await db.delete(organizations).where(eq(organizations.id, otherOrgId));
    }
  });
});
