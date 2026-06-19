/**
 * Pure unit tests for `buildLedgerModel` — the render-agnostic core of the
 * transport evidence ledger. Asserts the reconciliation invariant the PDF
 * leans on (Σ rounded legs = subtotal = total), distance-basis normalisation,
 * missing-mass handling, ref numbering, and the always-three-categories shape.
 * No renderer, no I/O.
 */
import { describe, expect, it } from "vitest";
import {
  buildLedgerModel,
  type TransportLegsByCategory,
} from "@/lib/certification/evidence-ledger/build-model";
import type { TransportLeg } from "@/db/schema";

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
    calculationMethodType: "distance_based",
    isDerived: false,
    ...overrides,
  } as unknown as TransportLeg;
}

function emptyCategories(): TransportLegsByCategory {
  return { feedstock: [], biochar: [], sample: [] };
}

const META = {
  removalCode: "CB-26-001",
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

  it("reconciles exactly: subtotal = Σ rounded legs, total = Σ subtotals", () => {
    const model = buildLedgerModel({
      ...META,
      legsByCategory: {
        feedstock: [
          leg({ distanceKm: 10, loadMassKg: 1000 }), // 10
          leg({ distanceKm: 5, loadMassKg: 2000 }), // 10
        ],
        biochar: [leg({ distanceKm: 32, loadMassKg: 2000 })], // 64
        sample: [leg({ distanceKm: 82, loadMassKg: 5 })], // 0.41
      },
    });
    const feed = model.categories.find((c) => c.key === "feedstock")!;
    const bio = model.categories.find((c) => c.key === "biochar")!;
    const samp = model.categories.find((c) => c.key === "sample")!;
    expect(feed.subtotalTkm).toBe(20);
    expect(bio.subtotalTkm).toBe(64);
    expect(samp.subtotalTkm).toBe(0.41);
    expect(model.totalTkm).toBe(20 + 64 + 0.41);
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
    expect(model.removalCode).toBe("CB-26-001");
    expect(model.facilityName).toBe("Dark Earth Hub");
    expect(model.externalProjectId).toBe("prj_TEST");
    expect(model.generatedAtIso).toBe("2026-06-19T00:00:00.000Z");
  });
});
