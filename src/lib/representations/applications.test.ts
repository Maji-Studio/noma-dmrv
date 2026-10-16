import { expect, it } from "vitest";
import { representApplication, representApplicationBoundary } from "./applications";
import type { Application } from "@/db/schema";
import type { GisBoundary } from "@/lib/geojson/types";

const id = "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b";
const at = new Date("2026-10-08T12:00:00Z");
const boundary: GisBoundary = { version: 1, source: "paste", fileName: null, capturedAt: at.toISOString(), notes: [],
  collection: { type: "FeatureCollection", features: [], bbox: [1, 2, 3, 4] },
  stats: { features: 2, vertices: 10, areaHectares: 12.5, bbox: [1, 2, 3, 4], center: [2, 3] } };
const row: Application = { id, organizationId: "hidden", code: "AP-1", version: 2, deliveryId: id,
  applicationDate: new Date("2026-09-12T00:00:00Z"), status: "applied", biocharAppliedTons: 4.001001,
  biocharAppliedDryTons: 3.000123, fieldSizeHa: 3, fieldIdentifier: null, cropType: null,
  applicationMethodType: null, evidenceMethod: "visual", gpsLatitude: null, gpsLongitude: null,
  gisBoundary: boundary, soilTemperatureSource: null, soilTemperatureC: null, co2eStoredTonnes: null,
  createdAt: at, updatedAt: at };

it("publishes application owned facts in kg and calendar dates, preserving legacy visual evidence", () => {
  const data = representApplication({ ...row, allocations: [{ biocharProductId: id, productionRunId: id, wetMassKg: 4001.001, dryMassKg: 3000.123 }] });
  expect(data).toEqual({ id, code: "AP-1", version: 2, deliveryId: id, applicationDate: "2026-09-12",
    appliedWetMassKg: 4001.001, dryBiocharKg: 3000.123, fieldSizeHa: 3, fieldIdentifier: null, cropType: null,
    applicationMethod: null, evidenceMethod: "visual", gpsLatitude: null, gpsLongitude: null,
    gisBoundary: { areaHectares: 12.5, featureCount: 2, vertexCount: 10, bbox: [1, 2, 3, 4], center: [2, 3] },
    soilTemperatureSource: null, soilTemperatureC: null,
    allocations: [{ biocharProductId: id, productionRunId: id, wetMassKg: 4001.001, dryBiocharKg: 3000.123 }],
    createdAt: at.toISOString(), updatedAt: at.toISOString() });
});

it("keeps geometry in the separate boundary read and preserves absent boundaries", () => {
  expect(representApplicationBoundary(boundary)).toEqual({ collection: boundary.collection,
    areaHectares: 12.5, featureCount: 2, vertexCount: 10, bbox: [1, 2, 3, 4], center: [2, 3] });
  expect(representApplication({ ...row, gisBoundary: null, allocations: [] }).gisBoundary).toBeNull();
});
