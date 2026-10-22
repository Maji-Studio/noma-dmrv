import { updateBiocharProductInTransaction } from "@/data-access/biochar-product-update";
import { deriveSourceBiocharMassKg, fromCompositionMassJsonb } from "@/lib/biochar-composition/composition";
import { beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { biocharProducts, feedstocks } from "@/db/schema";
import { updateFeedstockInTransaction } from "@/data-access/feedstocks";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

it("names changed feedstock operation fields in a real Sent lineage refusal without writing", async () => {
  await withLineageFixture(async fixture => {
    const ctx = makeTestOrgContext("test-user-00000000-0000-0000-0000-000000000001");
    const read = async () => (await db.select().from(feedstocks).where(and(eq(feedstocks.organizationId, TEST_ORG_ID), eq(feedstocks.id, fixture.feedstockId))))[0];
    const saved = await read();
    const change = { expectedVersion: saved.version, massWetKg: saved.massWetKg! + 1,
      transportDistanceKm: 42, transportDistanceSource: "document" as const, distanceNote: "Measured route" };
    const error = await db.transaction(tx => updateFeedstockInTransaction(ctx, tx, saved.id, change)).catch(error => error);
    expect(error).toMatchObject({ code: "certification_locked" });
    expect(error.issues).toEqual(["massWetKg", "transportDistanceKm", "transportDistanceSource", "distanceNote"].map(field => ({
      path: [field], code: "certification_locked", message: error.message,
    })));
    expect(await read()).toEqual(saved);
    const unchanged = await db.transaction(tx => updateFeedstockInTransaction(ctx, tx, saved.id, {
      expectedVersion: saved.version, massWetKg: saved.massWetKg!, transportDistanceKm: 0, distanceNote: "",
    })).catch(error => error);
    expect(unchanged).toMatchObject({ code: "certification_locked", issues: [] });
  }, "removal");
});

it("compares product source mass, not blend mass, in Sent lineage issues", async () => {
  await withLineageFixture(async fixture => {
    const ctx = makeTestOrgContext("test-user-00000000-0000-0000-0000-000000000001");
    // A blended fixture distinguishes the operation's source input from the
    // persisted pre-water blend total; no writer runs before the lock check.
    await db.update(biocharProducts).set({ composition: { ingredients: [{ massKg: 50 }] } })
      .where(and(eq(biocharProducts.organizationId, TEST_ORG_ID), eq(biocharProducts.id, fixture.productId)));
    const [saved] = await db.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, TEST_ORG_ID), eq(biocharProducts.id, fixture.productId)));
    const massKg = deriveSourceBiocharMassKg(saved.massKg, fromCompositionMassJsonb(saved.composition));
    expect(massKg).not.toBe(saved.massKg);
    const unchanged = await db.transaction(tx => updateBiocharProductInTransaction(ctx, tx, saved.id, {
      expectedVersion: saved.version, massKg, placedAt: saved.placedAt.toISOString(),
    })).catch(error => error);
    expect(unchanged).toMatchObject({ code: "certification_locked", issues: [] });
    const changed = await db.transaction(tx => updateBiocharProductInTransaction(ctx, tx, saved.id, {
      expectedVersion: saved.version, massKg: massKg! + 1,
    })).catch(error => error);
    expect(changed).toMatchObject({ code: "certification_locked", issues: [{ path: ["massKg"], code: "certification_locked" }] });
  }, "removal");
});
