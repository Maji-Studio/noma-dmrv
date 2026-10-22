import { updateBiocharProductInTransaction } from "@/data-access/biochar-product-update";
import { prepareBiocharProductSubmission } from "@/lib/biochar-composition/product-submission";
import type { BiocharProductFormData } from "@/schemas/biochar-products";
import { updateDeliveryInTransaction } from "@/data-access/delivery-output-writes";
import { updateApplicationInTransaction } from "@/data-access/application-writes";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, deliveries, biocharProducts, feedstocks } from "@/db/schema";
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

it("compares the real edit payload blend mass in Sent lineage issues", async () => {
  await withLineageFixture(async fixture => {
    const ctx = makeTestOrgContext("test-user-00000000-0000-0000-0000-000000000001");
    // The form displays source mass but submits the persisted blend total.
    await db.update(biocharProducts).set({ massKg: 150, composition: { ingredients: [{ massKg: 50 }] } })
      .where(and(eq(biocharProducts.organizationId, TEST_ORG_ID), eq(biocharProducts.id, fixture.productId)));
    const [saved] = await db.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, TEST_ORG_ID), eq(biocharProducts.id, fixture.productId)));
    const { massKg } = prepareBiocharProductSubmission({ massKg: 100, ingredientBins: [{ massKg: 50 }] } as BiocharProductFormData, true, saved.massKg!);
    expect(massKg).toBe(150);
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

it("does not flag feedstock transport values that normalize to the saved override", async () => {
  await withLineageFixture(async fixture => {
    const ctx = makeTestOrgContext();
    await db.update(feedstocks).set({ distanceKmOverride: 10, distanceSource: "manual", distanceNote: null })
      .where(and(eq(feedstocks.organizationId, TEST_ORG_ID), eq(feedstocks.id, fixture.feedstockId)));
    const [saved] = await db.select().from(feedstocks).where(and(eq(feedstocks.organizationId, TEST_ORG_ID), eq(feedstocks.id, fixture.feedstockId)));
    for (const patch of [{ transportDistanceKm: 10, transportDistanceSource: null, distanceNote: "" }, {}]) {
      await expect(db.transaction(tx => updateFeedstockInTransaction(ctx, tx, saved.id, { expectedVersion: saved.version, ...patch })))
        .rejects.toMatchObject({ code: "certification_locked", issues: [] });
    }
  }, "removal");
});

it("names changed delivery fields while normalized unchanged values never get issues", async () => {
  await withLineageFixture(async fixture => {
    const ctx = makeTestOrgContext();
    const [saved] = await db.select().from(deliveries).where(and(eq(deliveries.organizationId, TEST_ORG_ID), eq(deliveries.id, fixture.deliveryId)));
    const patch = { expectedVersion: saved.version, deliveryDate: saved.deliveryDate.toISOString(),
      deliveredWetMassKg: saved.deliveredWetMassKg!, distanceKmOverride: saved.distanceKmOverride,
      distanceSource: saved.distanceSource, distanceNote: saved.distanceNote ?? "" };
    const unchanged = await db.transaction(tx => updateDeliveryInTransaction(ctx, tx, saved.id, patch)).catch(error => error);
    expect(unchanged.code).toBe("certification_locked");
    expect(unchanged.issues.map((issue: { path: string[] }) => issue.path)).toEqual([["deliveryId"]]);
    const changed = await db.transaction(tx => updateDeliveryInTransaction(ctx, tx, saved.id, {
      ...patch, deliveredWetMassKg: saved.deliveredWetMassKg! + 1, distanceNote: "Changed route",
    })).catch(error => error);
    expect(changed.issues.map((issue: { path: string[] }) => issue.path)).toEqual([["deliveryId"], ["deliveredWetMassKg"], ["distanceNote"]]);
    const sourceChange = await db.transaction(tx => updateDeliveryInTransaction(ctx, tx, saved.id, {
      ...patch, sources: [{ layerId: fixture.productId.toUpperCase(), moisturePercent: 20 }],
    })).catch(error => error);
    expect(sourceChange.issues.map((issue: { path: string[] }) => issue.path)).toEqual([["deliveryId"], ["sources"]]);
    expect((await db.select().from(deliveries).where(and(eq(deliveries.organizationId, TEST_ORG_ID), eq(deliveries.id, saved.id))))[0]).toEqual(saved);
  }, "removal");
});

it("names changed application operation fields and normalizes saved dates, mass, method and text", async () => {
  await withLineageFixture(async fixture => {
    const ctx = makeTestOrgContext();
    const [saved] = await db.select().from(applications).where(and(eq(applications.organizationId, TEST_ORG_ID), eq(applications.id, fixture.applicationId)));
    const patch = { applicationId: saved.id, expectedVersion: saved.version, applicationDate: new Date(saved.applicationDate),
      appliedWetMassKg: tonnesToKg(saved.biocharAppliedTons), applicationMethod: saved.applicationMethodType,
      fieldIdentifier: ` ${saved.fieldIdentifier ?? ""} `, cropType: ` ${saved.cropType ?? ""} ` };
    const unchanged = await db.transaction(tx => updateApplicationInTransaction(ctx, tx, patch)).catch(error => error);
    expect(unchanged.code).toBe("certification_locked");
    expect(unchanged.issues.map((issue: { path: string[] }) => issue.path)).toEqual([["applicationId"]]);
    const changed = await db.transaction(tx => updateApplicationInTransaction(ctx, tx, {
      ...patch, appliedWetMassKg: patch.appliedWetMassKg + 1, fieldSizeHa: saved.fieldSizeHa + 1,
    })).catch(error => error);
    expect(changed.issues.map((issue: { path: string[] }) => issue.path)).toEqual([["applicationId"], ["fieldSizeHa"], ["appliedWetMassKg"]]);
    expect((await db.select().from(applications).where(and(eq(applications.organizationId, TEST_ORG_ID), eq(applications.id, saved.id))))[0]).toEqual(saved);
  }, "removal");
});
