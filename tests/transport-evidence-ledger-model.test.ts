/**
 * Pure unit tests for `buildLedgerModel` — the render-agnostic core of the
 * transport evidence ledger. Asserts that displayed rows can be rounded while
 * subtotals still match the canonical registry scalar, plus distance-basis
 * normalisation, missing-mass handling, ref numbering, and the always-three-
 * categories shape. No renderer, no I/O.
 */
import { describe, expect, it } from "vitest";
import {
  buildLedgerModel,
} from "@/lib/certification/evidence-ledger/build-model";
import type { TransportLeg } from "@/db/schema";
import type { TransportLegsByCategory } from "@/lib/isometric/utils/aggregation";

function leg(overrides: Partial<TransportLeg>): TransportLeg {
  return {
    id: "leg-x",
    entityType: "feedstock",
    entityId: "ent-x",
    originName: "Origin Co.",
    originGpsLatitude: -3.286,
    originGpsLongitude: 37.157,
    destinationName: "Facility",
    destinationGpsLatitude: -3.348,
    destinationGpsLongitude: 37.34,
    distanceKm: 10,
    distanceSource: "map_estimate",
    transportMethodType: "road",
    vehicleType: "Heavy truck",
    modelYear: null,
    loadMassKg: 1000,
    // These cases assert exact one-way t·km reconciliation, so the builder pins
    // `one_way` (no ×2). The round-trip doubling (#316) is covered by its own
    // case below and in the aggregation unit tests.
    tripType: "one_way",
    calculationMethodType: "distance_based",
    isDerived: false,
    ...overrides,
  } as unknown as TransportLeg;
}

function emptyCategories(): TransportLegsByCategory {
  return { feedstock: [], biochar: [], sample: [] };
}

const META = {
  memberBatchCodes: "CB-26-001",
  facilityName: "Dark Earth Hub",
  externalProjectId: "prj_TEST",
  generatedAtIso: "2026-06-19T00:00:00.000Z",
};

describe("buildLedgerModel", () => {
  it("computes per-leg t·km as distanceKm × loadMassKg ÷ 1000, rounded to 2dp", () => {
    const model = buildLedgerModel({
      ...META,
      legsByCategory: {
        ...emptyCategories(),
        feedstock: [leg({ distanceKm: 34, loadMassKg: 4500 })],
      },
    });
    // 34 * 4500 / 1000 = 153
    expect(model.categories.find((c) => c.key === "feedstock")!.legs[0].tkm).toBe(
      153,
    );
  });

  it("doubles a Return leg's distance and t·km, reconciling to the subtotal (#316)", () => {
    const model = buildLedgerModel({
      ...META,
      legsByCategory: {
        ...emptyCategories(),
        feedstock: [leg({ distanceKm: 34, loadMassKg: 4500, tripType: "return" })],
      },
    });
    const cat = model.categories.find((c) => c.key === "feedstock")!;
    // Round trip: distance shown as 68 (34 × 2), t·km = 68 × 4.5 = 306.
    expect(cat.legs[0].distanceKm).toBe(68);
    expect(cat.legs[0].roundTrip).toBe(true);
    expect(cat.legs[0].tkm).toBe(306);
    expect(cat.subtotalTkm).toBe(306);
  });

  it("sets subtotal from the canonical raw-sum scalar, not Σ rounded rows", () => {
    const model = buildLedgerModel({
      ...META,
      legsByCategory: {
        feedstock: [
          leg({ id: "leg-1", distanceKm: 1, loadMassKg: 5 }), // row display 0.01
          leg({ id: "leg-2", distanceKm: 1, loadMassKg: 5 }), // row display 0.01
        ],
        biochar: [leg({ distanceKm: 32, loadMassKg: 2000 })],
        sample: [leg({ distanceKm: 82, loadMassKg: 5 })],
      },
    });
    const feed = model.categories.find((c) => c.key === "feedstock")!;
    const bio = model.categories.find((c) => c.key === "biochar")!;
    const samp = model.categories.find((c) => c.key === "sample")!;
    expect(feed.legs.map((l) => l.tkm)).toEqual([0.01, 0.01]);
    expect(feed.subtotalTkm).toBe(0.01);
    expect(bio.subtotalTkm).toBe(64);
    expect(samp.subtotalTkm).toBe(0.41);
    expect(model.totalTkm).toBe(0.01 + 64 + 0.41);
    expect(model.totalLegs).toBe(4);
  });

  it("treats missing load mass as 0 t·km and flags it", () => {
    const model = buildLedgerModel({
      ...META,
      legsByCategory: {
        ...emptyCategories(),
        feedstock: [leg({ distanceKm: 100, loadMassKg: null })],
      },
    });
    const l = model.categories.find((c) => c.key === "feedstock")!.legs[0];
    expect(l.tkm).toBe(0);
    expect(l.massMissing).toBe(true);
    expect(l.loadMassKg).toBe(0);
  });

  it("treats zero load mass as 0 t·km and flags it", () => {
    const model = buildLedgerModel({
      ...META,
      legsByCategory: {
        ...emptyCategories(),
        feedstock: [leg({ distanceKm: 100, loadMassKg: 0 })],
      },
    });
    const l = model.categories.find((c) => c.key === "feedstock")!.legs[0];
    expect(l.tkm).toBe(0);
    expect(l.massMissing).toBe(true);
    expect(l.loadMassKg).toBe(0);
  });

  it("normalises the distance basis from isDerived + distanceSource", () => {
    const model = buildLedgerModel({
      ...META,
      legsByCategory: {
        feedstock: [
          leg({ isDerived: true, distanceSource: "manual" }), // derived wins
          leg({ isDerived: false, distanceSource: "manual" }),
          leg({ isDerived: false, distanceSource: "document" }),
          leg({ isDerived: false, distanceSource: "map_estimate" }),
        ],
        biochar: [],
        sample: [],
      },
    });
    const bases = model.categories
      .find((c) => c.key === "feedstock")!
      .legs.map((l) => l.basis);
    expect(bases).toEqual([
      "Map · derived",
      "Map · manual",
      "Document",
      "Map · estimate",
    ]);
  });

  it("numbers legs per category with the category ref prefix and capitalises mode", () => {
    const model = buildLedgerModel({
      ...META,
      legsByCategory: {
        feedstock: [leg({}), leg({})],
        biochar: [leg({ entityType: "biochar", transportMethodType: "rail" })],
        sample: [leg({ entityType: "sample" })],
      },
    });
    expect(
      model.categories.find((c) => c.key === "feedstock")!.legs.map((l) => l.ref),
    ).toEqual(["FL-01", "FL-02"]);
    expect(model.categories.find((c) => c.key === "biochar")!.legs[0].ref).toBe(
      "BL-01",
    );
    expect(model.categories.find((c) => c.key === "sample")!.legs[0].ref).toBe(
      "SL-01",
    );
    expect(model.categories.find((c) => c.key === "biochar")!.legs[0].mode).toBe(
      "Rail",
    );
  });

  it("always returns three categories, even when empty", () => {
    const model = buildLedgerModel({ ...META, legsByCategory: emptyCategories() });
    expect(model.categories.map((c) => c.key)).toEqual([
      "feedstock",
      "biochar",
      "sample",
    ]);
    expect(model.totalLegs).toBe(0);
    expect(model.totalTkm).toBe(0);
    expect(model.categories.every((c) => c.subtotalTkm === 0)).toBe(true);
  });

  it("passes through caller metadata verbatim", () => {
    const model = buildLedgerModel({ ...META, legsByCategory: emptyCategories() });
    expect(model.memberBatchCodes).toBe("CB-26-001");
    expect(model.facilityName).toBe("Dark Earth Hub");
    expect(model.externalProjectId).toBe("prj_TEST");
    expect(model.generatedAtIso).toBe("2026-06-19T00:00:00.000Z");
  });

  // §8.6.2 delivery bucket (issue #349, ADR 0020): the submitted biochar
  // scalar is leg-sum × applied share, so a partially-applied removal's ledger
  // must carry the scaling explicitly to stay an honest reconciliation.
  describe("applied-biochar scaling (delivery bucket, §8.6.2)", () => {
    const scaledLegs: TransportLegsByCategory = {
      feedstock: [leg({ id: "leg-f", distanceKm: 50, loadMassKg: 1000 })], // 50
      biochar: [leg({ id: "leg-b", distanceKm: 10, loadMassKg: 1000 })], // 10
      sample: [leg({ id: "leg-s", distanceKm: 20, loadMassKg: 500 })], // 10
    };

    it("reconciles the biochar subtotal to leg-sum × fraction; feedstock/sample stay raw sums", () => {
      const model = buildLedgerModel({
        ...META,
        legsByCategory: scaledLegs,
        appliedBiocharFraction: 0.4,
      });
      const feed = model.categories.find((c) => c.key === "feedstock")!;
      const bio = model.categories.find((c) => c.key === "biochar")!;
      const samp = model.categories.find((c) => c.key === "sample")!;
      // PRODUCTION-bucket categories: raw sums, no scaling detail.
      expect(feed.subtotalTkm).toBe(50);
      expect(feed.scaling).toBeUndefined();
      expect(samp.subtotalTkm).toBe(10);
      expect(samp.scaling).toBeUndefined();
      // DELIVERY bucket: submitted scalar = 10 × 0.4, operands exposed.
      expect(bio.subtotalTkm).toBe(4);
      expect(bio.scaling).toEqual({ rawSubtotalTkm: 10, appliedFraction: 0.4 });
      // The grand total sums the RECONCILED subtotals (matches submission).
      expect(model.totalTkm).toBe(50 + 4 + 10);
    });

    it("omits scaling and keeps the raw biochar subtotal at full application", () => {
      const full = buildLedgerModel({
        ...META,
        legsByCategory: scaledLegs,
        appliedBiocharFraction: 1,
      });
      const omitted = buildLedgerModel({ ...META, legsByCategory: scaledLegs });
      for (const model of [full, omitted]) {
        const bio = model.categories.find((c) => c.key === "biochar")!;
        expect(bio.subtotalTkm).toBe(10);
        expect(bio.scaling).toBeUndefined();
        // Omitted (not null) so fully-applied ledgers keep the same JSON
        // shape — and therefore content hash — as before the scaling field.
        expect("scaling" in bio).toBe(false);
      }
    });

    it("clamps an out-of-range fraction like the submit pipeline does", () => {
      const above = buildLedgerModel({
        ...META,
        legsByCategory: scaledLegs,
        appliedBiocharFraction: 1.5,
      });
      expect(
        above.categories.find((c) => c.key === "biochar")!.subtotalTkm,
      ).toBe(10);
      expect(
        above.categories.find((c) => c.key === "biochar")!.scaling,
      ).toBeUndefined();

      const below = buildLedgerModel({
        ...META,
        legsByCategory: scaledLegs,
        appliedBiocharFraction: -0.5,
      });
      const bio = below.categories.find((c) => c.key === "biochar")!;
      expect(bio.subtotalTkm).toBe(0);
      expect(bio.scaling).toEqual({ rawSubtotalTkm: 10, appliedFraction: 0 });
    });
  });
});
