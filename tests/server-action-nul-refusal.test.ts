import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { isPgNulCharacterError } from "@/db/errors";
import { suppliers } from "@/db/schema";
import { createSupplierWithLocationsFn } from "@/fn/suppliers";
import { createApiOrderReadFixture, removeApiOrderReadFixture, type ApiOrderReadFixture } from "./helpers/api-order-read-fixture";

const auth = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth/providers/better-auth-server", async original => ({
  ...await original<typeof import("@/lib/auth/providers/better-auth-server")>(), getBetterAuthSession: auth.session,
}));
const TIMEOUT_MS = 60_000;
const NUL_MESSAGE = "This value contains a NUL character (U+0000), which noma cannot store. Remove it and retry.";

async function refusal(query: Promise<unknown>): Promise<unknown> {
  return query.then(() => { throw new Error("Expected PostgreSQL to refuse the value."); }, (error: unknown) => error);
}

describe("PostgreSQL NUL refusals (real database)", () => {
  it("matches the driver's text and jsonb refusals", async () => {
    expect(isPgNulCharacterError(await refusal(db.execute(sql`select ${"a\u0000b"}::text`)))).toBe(true);
    expect(isPgNulCharacterError(await refusal(db.execute(sql`select ${'{"a":"\\u0000"}'}::jsonb`)))).toBe(true);
  });

  it("does not match an unrelated database error", async () => {
    expect(isPgNulCharacterError(await refusal(db.execute(sql`select 1 / 0`)))).toBe(false);
  });
});

describe("Server Action NUL refusal (real database)", () => {
  let f: ApiOrderReadFixture;
  beforeEach(async () => {
    f = await createApiOrderReadFixture();
    auth.session.mockResolvedValue({ user: { id: f.ctx.userId }, session: { activeOrganizationId: f.ctx.organizationId } });
  }, TIMEOUT_MS);
  afterEach(async () => {
    if (f) await removeApiOrderReadFixture(f);
  }, TIMEOUT_MS);

  it("answers a validation failure for a NUL in a supplier location name", async () => {
    const result = await createSupplierWithLocationsFn({
      supplier: { name: "NUL supplier" },
      locations: [{ name: "\u0000K\u00971", country: "Tanzania", gpsLatitude: -8.9, gpsLongitude: 33.4, isDefault: true }],
    });
    expect(result).toMatchObject({ success: false, error: NUL_MESSAGE, code: "validation_failed" });
    expect(await db.select({ id: suppliers.id }).from(suppliers)
      .where(and(eq(suppliers.organizationId, f.ctx.organizationId), eq(suppliers.name, "NUL supplier")))).toEqual([]);
  }, TIMEOUT_MS);
});
