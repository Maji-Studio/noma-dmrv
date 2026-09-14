import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { feedstockTypes, organizations } from "@/db/schema";
import { createFeedstockType } from "@/data-access/quick-add";
import * as canonical from "@/data-access/feedstock-types";
import { makeTestOrgContext, ensureTestOrg } from "./helpers/test-org";

const codes: string[] = [];
beforeAll(() => ensureTestOrg());
afterEach(async () => {
  if (codes.length) await db.delete(feedstockTypes).where(inArray(feedstockTypes.code, codes.splice(0)));
});
function input() {
  const code = `FT-AUDIT-${crypto.randomUUID()}`;
  codes.push(code);
  return { code, name: code, category: "forestry" as const, usage: "pyrolysis" as const, isometricFeedstockTypeId: `ft_${crypto.randomUUID()}` };
}

describe("feedstock type quick-add canonical policy", () => {
  it("rejects Members through the real canonical DAL without inserting", async () => {
    const data = input();
    const spy = vi.spyOn(canonical, "createFeedstockType");
    await expect(createFeedstockType({ ...makeTestOrgContext(), orgRole: "member" }, data))
      .rejects.toThrow("permission");
    expect(spy).toHaveBeenCalledOnce();
    expect(await db.select().from(feedstockTypes).where(eq(feedstockTypes.code, data.code))).toEqual([]);
  });

  it.each(["admin", "owner"] as const)("allows %s and persists registry selection with EntityOption", async (orgRole) => {
    const data = input();
    const ctx = { ...makeTestOrgContext(), orgRole };
    const spy = vi.spyOn(canonical, "createFeedstockType");
    const result = await createFeedstockType(ctx, { ...data, name: ` ${data.name} ` });
    expect(spy).toHaveBeenCalledWith(ctx, expect.objectContaining({ isometricFeedstockTypeId: data.isometricFeedstockTypeId }));
    expect(result).toEqual({ id: expect.any(String), code: data.code, name: data.name, subtitle: "forestry · pyrolysis" });
    const [saved] = await db.select().from(feedstockTypes).where(eq(feedstockTypes.id, result.id));
    expect(saved).toMatchObject({ organizationId: ctx.organizationId, isometricFeedstockTypeId: data.isometricFeedstockTypeId });
  });

  it("keeps duplicate name/usage handling scoped to the active organization", async () => {
    const data = input();
    const duplicate = input();
    const ctx = makeTestOrgContext();
    const otherOrgId = `org-audit-${crypto.randomUUID()}`;
    await db.insert(organizations).values({ id: otherOrgId, name: otherOrgId, slug: otherOrgId });
    try {
      await createFeedstockType(ctx, data);
      await expect(createFeedstockType(ctx, { ...duplicate, name: ` ${data.name} ` })).rejects.toThrow("name and usage already exists");
      await expect(createFeedstockType({ ...ctx, organizationId: otherOrgId }, data)).resolves.toMatchObject({ name: data.name });
    } finally {
      await db.delete(feedstockTypes).where(eq(feedstockTypes.organizationId, otherOrgId));
      await db.delete(organizations).where(eq(organizations.id, otherOrgId));
    }
  });
});
