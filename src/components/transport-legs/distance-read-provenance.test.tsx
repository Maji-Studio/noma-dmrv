/**
 * Feedstock and delivery read views must say the same thing behind the
 * One-way distance ⓘ, from their own record shapes.
 */
import { describe, expect, it, vi } from "vitest";
import type { DetailPanelSection } from "@/components/ui/detail-panel";

vi.mock("@/components/transport-legs", () => ({
  TransportEvidencePanel: () => null, TransportLegsSummary: () => null, TransportRoutePreview: () => null,
}));
vi.mock("@/components/transport-legs/transport-distance-drift", () => ({ TransportDistanceDriftNotice: () => null }));
vi.mock("@/components/deliveries/delivery-stock-details", () => ({ DeliveryStockDetails: () => null }));
vi.mock("@/components/ui/moisture-split", () => ({ MoistureSplit: () => null }));

import { deliverySheetSections } from "@/components/deliveries/delivery-read-sections";
import { feedstockSheetSections } from "@/components/feedstocks/feedstock-read-sections";

const distanceHint = (sections: DetailPanelSection[]) =>
  sections.flatMap(section => section.fields).find(field => field.label === "One-way distance")?.hint;

const delivery = (override: number | null) => deliverySheetSections({
  id: "delivery", code: "DL-26-001", facilityId: "facility", deliveryDate: new Date("2026-10-03T12:00:00Z"), status: "delivered",
  distanceKmOverride: override, distanceNote: override ? "Detour" : null, recordedDistanceKm: 25, recordedDistanceSource: "manual",
  destinationName: "Dar farm", effectiveDistanceKm: override ?? 25, effectiveDistanceSource: "manual",
} as never, []);

const feedstock = (override: number | null) => feedstockSheetSections({
  id: "feedstock", code: "FS-26-001", deliveryDate: new Date("2026-10-02"), supplierName: "Kilolo depot",
  distanceKmOverride: override, distanceSource: override ? "manual" : null, distanceNote: override ? "Detour" : null,
} as never, { distanceKm: override ? 60 : 25, source: "manual", locationDefaultKm: 25, pending: false });

describe("read-view distance provenance", () => {
  it("reads an override the same on a feedstock and a delivery", () => {
    expect(distanceHint(delivery(30))).toBe("Override. Location default is 25 km.");
    expect(distanceHint(feedstock(60))).toBe("Override. Location default is 25 km.");
  });

  it("reads a derived distance the same on a feedstock and a delivery", () => {
    expect(distanceHint(delivery(null))).toBe("From Dar farm. Source: Manual entry.");
    expect(distanceHint(feedstock(null))).toBe("From Kilolo depot. Source: Manual entry.");
  });
});
