import { describe, expect, it } from "vitest";
import { formatDateTime } from "@/lib/format-utils";
import {
  activityFieldLines,
  activityLinkRecordNoun,
  formatActivityValue,
  formatStoredDecimal,
} from "./activity-change-lines";
import { activityFieldLabel, type ActivityItem } from "./activity-display";

const FACILITY_TIME_ZONE = "Africa/Dar_es_Salaam";
const live = { label: "AP-001", deleted: false, facilityId: "facility-1", facilityTimezone: FACILITY_TIME_ZONE };
const SUPPLIER_ID = "0b8f8a52-7a8c-4d71-9a3e-0d7c2f1f7e11";
const OTHER_ID = "5c1e6f0e-2a8b-4c4f-8d0a-6f9b1d2e3a44";

type LinkSide = NonNullable<NonNullable<ActivityItem["changeLabels"]>[string]["from"]>;
const named = (label: string, type = "supplier"): LinkSide => ({ label, deleted: false, type });
const deleted = (type: string | null = "supplier"): LinkSide => ({ label: null, deleted: true, type });
const unnamed: LinkSide = { label: null, deleted: false, type: "supplier" };

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "event-1", action: "updated", entityType: "application", entityId: "app-1", changedFields: [],
    changes: {}, changeLabels: {},
    fromStatus: null, toStatus: null, fromRemote: null, toRemote: null, source: "form",
    occurredAt: new Date("2026-10-15T21:00:00Z"), registryAt: null, reasonCode: null,
    actor: { id: "user-1", name: "Ada Operator" }, record: live, ...overrides,
  };
}

const grouped = (value: number, digits: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

describe("one line per changed field", () => {
  it("shows old and new values, Not recorded for a missing value, and changed for name-only fields", () => {
    const lines = activityFieldLines(item({
      entityType: "feedstock",
      changedFields: ["massWetKg", "notes", "moistureContentPercent"],
      changes: { massWetKg: { from: "600", to: "650" }, moistureContentPercent: { from: null, to: "14.2" } },
    }));
    expect(lines).toEqual([
      { kind: "value", key: "massWetKg", label: "Wet mass (kg)", from: { text: "600", tone: "value" }, to: { text: "650", tone: "value" } },
      { kind: "changed", key: "notes", label: "Notes" },
      { kind: "value", key: "moistureContentPercent", label: "Moisture (%)", from: { text: "Not recorded", tone: "missing" }, to: { text: "14.2", tone: "value" } },
    ]);
  });

  it("drops bookkeeping fields and lists none for creations, deletions and registry status events", () => {
    expect(activityFieldLines(item({ changedFields: ["version", "facilityId"] }))).toEqual([]);
    for (const action of ["created", "deleted", "status_changed"] as const) {
      expect(activityFieldLines(item({ action, changedFields: ["notes"], changes: { cropType: { from: "a", to: "b" } } }))).toEqual([]);
    }
  });

  it("keeps a status as a status change, for the shared badges", () => {
    expect(activityFieldLines(item({ changedFields: ["status"], changes: { status: { from: "delivered", to: "applied" } } })))
      .toEqual([{ kind: "status", key: "status", label: "Status", from: "delivered", to: "applied" }]);
  });

  it("leaves a run's batch membership to its summary", () => {
    const lines = activityFieldLines(item({
      entityType: "production_run", reasonCode: "attached", changedFields: ["credit_batch"],
      changes: { credit_batch: { from: null, to: OTHER_ID } },
      changeLabels: { credit_batch: { from: null, to: named("CB-1", "credit_batch") } },
    }));
    expect(lines).toEqual([]);
  });

  it("never shows a raw id, even without a link label", () => {
    expect(activityFieldLines(item({ entityType: "feedstock", changedFields: ["supplierId"], changes: { supplierId: { from: SUPPLIER_ID, to: OTHER_ID } } })))
      .toEqual([{ kind: "changed", key: "supplierId", label: "Supplier" }]);
  });
});

describe("GPS points", () => {
  it("reads latitude and longitude as one point", () => {
    expect(activityFieldLines(item({
      changedFields: ["gpsLatitude", "gpsLongitude"],
      changes: { gpsLatitude: { from: "-8.1234", to: "-8.124" }, gpsLongitude: { from: "35.5", to: "35.51" } },
    }))).toEqual([{
      kind: "value", key: "GPS point", label: "GPS point",
      from: { text: "-8.1234, 35.5", tone: "value" }, to: { text: "-8.124, 35.51", tone: "value" },
    }]);
  });

  it("names origin and destination points on a transport leg, and reads a missing point as Not recorded", () => {
    const lines = activityFieldLines(item({
      entityType: "transport_leg",
      changedFields: ["destinationGpsLatitude", "destinationGpsLongitude", "originGpsLatitude", "originGpsLongitude"],
      changes: {
        destinationGpsLatitude: { from: null, to: "1.5" }, destinationGpsLongitude: { from: null, to: "2.5" },
        originGpsLatitude: { from: "3", to: "4" }, originGpsLongitude: { from: "5", to: "6" },
      },
    }));
    expect(lines.map((line) => line.label)).toEqual(["Destination GPS point", "Origin GPS point"]);
    expect(lines[0]).toMatchObject({ from: { text: "Not recorded", tone: "missing" }, to: { text: "1.5, 2.5" } });
    expect(lines[1]).toMatchObject({ from: { text: "3, 5" }, to: { text: "4, 6" } });
  });

  it("reads a point when only one coordinate changed, the partner sent unchanged", () => {
    expect(activityFieldLines(item({
      changedFields: ["gpsLongitude"],
      changes: { gpsLatitude: { from: "-8.1234", to: "-8.1234" }, gpsLongitude: { from: "35.5", to: "35.51" } },
    }))).toEqual([{
      kind: "value", key: "GPS point", label: "GPS point",
      from: { text: "-8.1234, 35.5", tone: "value" }, to: { text: "-8.1234, 35.51", tone: "value" },
    }]);
  });

  it("shows only the coordinate that changed on older rows without the partner", () => {
    expect(activityFieldLines(item({ changedFields: ["gpsLatitude"], changes: { gpsLatitude: { from: "-8.1", to: "-8.2" } } })))
      .toEqual([{ kind: "value", key: "gpsLatitude", label: "GPS latitude", from: { text: "-8.1", tone: "value" }, to: { text: "-8.2", tone: "value" } }]);
    expect(activityFieldLines(item({ changedFields: ["gpsLatitude"], changes: { gpsLatitude: { from: null, to: "-8.2" } } }))[0])
      .toMatchObject({ from: { text: "Not recorded", tone: "missing" } });
  });

  it("names a missing coordinate inside a point", () => {
    expect(activityFieldLines(item({
      changedFields: ["gpsLatitude"],
      changes: { gpsLatitude: { from: null, to: "-8.2" }, gpsLongitude: { from: "35.5", to: "35.5" } },
    }))[0]).toMatchObject({ from: { text: "Not recorded, 35.5" }, to: { text: "-8.2, 35.5" } });
  });
});

describe("links", () => {
  const supplierChange = (from: LinkSide | null, to: LinkSide | null) =>
    activityFieldLines(item({
      entityType: "feedstock", changedFields: ["supplierId"],
      changes: { supplierId: { from: from ? SUPPLIER_ID : null, to: to ? OTHER_ID : null } },
      changeLabels: { supplierId: { from, to } },
    }));

  it("shows the record's current name, and Not set for no record", () => {
    expect(supplierChange(named("Acme farms"), null)).toEqual([{
      kind: "value", key: "supplierId", label: "Supplier",
      from: { text: "Acme farms", tone: "value" }, to: { text: "Not set", tone: "missing" },
    }]);
  });

  it("names a deleted record by the type the server resolved", () => {
    expect(supplierChange(deleted(), named("Acme farms"))[0])
      .toMatchObject({ from: { text: "Deleted supplier", tone: "deleted" }, to: { text: "Acme farms" } });
    expect(supplierChange(deleted("storage_location"), named("Bin A"))[0])
      .toMatchObject({ from: { text: "Deleted storage bin", tone: "deleted" } });
    expect(supplierChange(deleted("lab_sample"), named("S-002"))[0]).toMatchObject({ from: { text: "Deleted Sample" } });
    expect(supplierChange(deleted(null), named("Acme farms"))[0]).toMatchObject({ from: { text: "Deleted record", tone: "deleted" } });
  });

  it("reads a link with no name as changed", () => {
    expect(supplierChange(unnamed, named("Acme farms")))
      .toEqual([{ kind: "changed", key: "supplierId", label: "Supplier" }]);
  });

  it("names record types mid-sentence, keeping glossary capitals", () => {
    expect(activityLinkRecordNoun("storage_location")).toBe("storage bin");
    expect(activityLinkRecordNoun("feedstock_type")).toBe("feedstock type");
    expect(activityLinkRecordNoun("delivery")).toBe("delivery");
    expect(activityLinkRecordNoun("ghg_statement")).toBe("GHG Statement");
    expect(activityLinkRecordNoun("removal")).toBe("Removal");
    expect(activityLinkRecordNoun("future_thing")).toBe("future thing");
  });
});

describe("values", () => {
  it("keeps the stored precision and groups thousands", () => {
    expect(formatStoredDecimal("14.2")).toBe(grouped(14.2, 1));
    expect(formatStoredDecimal("14.20")).toBe(grouped(14.2, 2));
    expect(formatStoredDecimal("1234.5")).toBe(grouped(1234.5, 1));
    expect(formatStoredDecimal("-0.003")).toBe(grouped(-0.003, 3));
    expect(formatStoredDecimal("1234567890.123456789")).toBe("1234567890.123456789");
  });

  it("shows codes and years as typed", () => {
    expect(formatActivityValue("modelYear", "2019")).toEqual({ text: "2019", tone: "value" });
    expect(formatActivityValue("fieldIdentifier", "12345")).toEqual({ text: "12345", tone: "value" });
  });

  it("formats days, calendar dates and instants as the app does", () => {
    expect(formatActivityValue("analysisDate", "2026-10-15").text).toBe("Oct 15, 2026");
    expect(formatActivityValue("applicationDate", "2026-10-15T00:00:00.000Z").text).toBe("Oct 15, 2026");
    expect(formatActivityValue("samplingTime", "2026-10-15T08:30:00.000Z").text).toBe(formatDateTime("2026-10-15T08:30:00.000Z"));
  });

  it("reads an instant on the record's facility clock", () => {
    expect(formatActivityValue("samplingTime", "2026-10-15T08:30:00.000Z", FACILITY_TIME_ZONE).text).toBe("Oct 15, 2026, 11:30");
    const [line] = activityFieldLines(item({
      entityType: "lab_sample", changedFields: ["samplingTime"],
      changes: { samplingTime: { from: "2026-10-15T08:30:00.000Z", to: "2026-10-15T21:15:00.000Z" } },
    }));
    expect(line).toMatchObject({ from: { text: "Oct 15, 2026, 11:30" }, to: { text: "Oct 16, 2026, 00:15" } });
    // Calendar days and UTC-midnight business dates do not move with the clock.
    expect(formatActivityValue("analysisDate", "2026-10-15", FACILITY_TIME_ZONE).text).toBe("Oct 15, 2026");
    expect(formatActivityValue("applicationDate", "2026-10-15T00:00:00.000Z", FACILITY_TIME_ZONE).text).toBe("Oct 15, 2026");
  });

  it("reads a missing choice as Not set and any other missing value as Not recorded", () => {
    for (const field of ["evidenceMethod", "distanceSource", "documentType", "entityType"]) {
      expect(formatActivityValue(field, null)).toEqual({ text: "Not set", tone: "missing" });
    }
    for (const field of ["massWetKg", "analysisDate", "samplingTime", "labName", "gpsLatitude"]) {
      expect(formatActivityValue(field, null)).toEqual({ text: "Not recorded", tone: "missing" });
    }
  });

  it("reads choices in the forms' words, unknown ones humanized", () => {
    expect(formatActivityValue("evidenceMethod", "boundary").text).toBe("GIS reference");
    expect(formatActivityValue("evidenceMethod", "future_method").text).toBe("Future method");
    expect(formatActivityValue("applicationMethodType", "mechanical").text).toBe("Mechanical");
    expect(formatActivityValue("distanceSource", "map_estimate").text).toBe("Route calculation");
    expect(formatActivityValue("recordedDistanceSource", "document").text).toBe("Transport document");
    expect(formatActivityValue("soilTemperatureSource", "global_database").text).toBe("Global Database");
    expect(formatActivityValue("sampling", "unsampled").text).toBe("Unsampled");
    expect(formatActivityValue("vehicleType", "truck").text).toBe("Truck");
    // Owner types read as the link labels do.
    expect(formatActivityValue("entityType", "biochar").text).toBe("Biochar product");
    expect(formatActivityValue("entityType", "sample").text).toBe("Sample");
  });
});

describe("labels", () => {
  it("fixes casing, units and names at the label source", () => {
    expect(activityFieldLabel("lab_sample", "ph")).toBe("pH");
    expect(activityFieldLabel("application", "gisBoundary")).toBe("Boundary");
    expect(activityFieldLabel("application", "fieldSizeHa")).toBe("Field size (ha)");
    expect(activityFieldLabel("application", "soilTemperatureC")).toBe("Soil temperature (°C)");
    expect(activityFieldLabel("production_run", "feedstockWetMassKg")).toBe("Feedstock wet mass (kg)");
    expect(activityFieldLabel("lab_sample", "bulkDensityKgPerM3")).toBe("Bulk density (kg/m³)");
    expect(activityFieldLabel("lab_sample", "saltContentGPerKg")).toBe("Salt content (g/kg)");
    expect(activityFieldLabel("production_run", "feedingRateKgHr")).toBe("Feeding rate (kg/h)");
  });
});
