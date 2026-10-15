import { describe, expect, it } from "vitest";
import { ACTIVITY_ENTITY_TYPES } from "@/db/schema/common";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { getStatusState } from "@/lib/status-state";
import { toBadgeProps } from "@/components/chain-of-custody/chain-status-badge";
import {
  ACTIVITY_RECORD_TYPE_LABELS,
  ACTIVITY_RECORD_TYPE_ORDER,
  activityActorDisplay,
  activityChangeSummary,
  activityChangedFieldLabels,
  activityFieldLabel,
  activityRecordHref,
  activityRecordLabel,
  activityRecordTypeLabel,
  activityStatusKey,
  humanizeFieldName,
  type ActivityItem,
} from "./activity-display";

const FACILITY = "facility-1";
const BATCH = "batch-1";
const CONTEXT = { creditBatchId: BATCH };
const live = { label: "PR-001", deleted: false, facilityId: FACILITY };

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "event-1", action: "updated", entityType: "production_run", entityId: "run-1", changedFields: [],
    fromStatus: null, toStatus: null, fromRemote: null, toRemote: null, source: "form",
    occurredAt: new Date("2026-10-15T21:00:00Z"), registryAt: null, reasonCode: null,
    actor: { id: "user-1", name: "Ada Operator" }, record: live, ...overrides,
  };
}

describe("record types", () => {
  it("labels and orders every schema entity type", () => {
    expect([...ACTIVITY_RECORD_TYPE_ORDER].sort()).toEqual([...ACTIVITY_ENTITY_TYPES].sort());
    for (const type of ACTIVITY_ENTITY_TYPES) expect(ACTIVITY_RECORD_TYPE_LABELS[type]).toMatch(/^[A-Z]/);
  });

  it("keeps glossary capitals and reads unknown types", () => {
    expect(activityRecordTypeLabel("lab_sample")).toBe("Sample");
    expect(activityRecordTypeLabel("ghg_statement")).toBe("GHG Statement");
    expect(activityRecordTypeLabel("future_thing")).toBe("Future thing");
  });
});

describe("who made the change", () => {
  it("names a person and the channel a non-form change came through", () => {
    expect(activityActorDisplay(item())).toEqual({ name: "Ada Operator", missing: false, channel: null });
    expect(activityActorDisplay(item({ source: "rest" }))).toMatchObject({ channel: "via API" });
    expect(activityActorDisplay(item({ source: "mcp" }))).toMatchObject({ channel: "via MCP" });
    expect(activityActorDisplay(item({ source: "registry" }))).toMatchObject({ channel: "via registry" });
  });

  it("lets an actorless source stand in for the person", () => {
    expect(activityActorDisplay(item({ actor: null, source: "system" }))).toEqual({ name: "System", missing: false, channel: null });
    expect(activityActorDisplay(item({ actor: null, source: "registry" }))).toMatchObject({ name: "Registry" });
    expect(activityActorDisplay(item({ actor: null, source: "script" }))).toMatchObject({ name: "Script" });
  });

  it("uses the shared token for a person whose name cannot be read", () => {
    expect(activityActorDisplay(item({ actor: { id: "gone", name: null } }))).toEqual({
      name: MISSING_VALUE.notAvailable, missing: true, channel: null,
    });
  });
});

describe("changed field names", () => {
  it("prefers known labels, then the certification field registry", () => {
    expect(activityFieldLabel("credit_batch", "production_runs")).toBe("Production runs");
    expect(activityFieldLabel("production_run", "readingsCsv")).toBe("Readings CSV file");
    expect(activityFieldLabel("feedstock", "massWetKg")).toBe("Wet mass (kg)");
    expect(activityFieldLabel("credit_batch", "removalTemplateId")).toBe("Removal template");
    expect(activityFieldLabel("feedstock", "moistureContentPercent")).toBe("Moisture (%)");
  });

  it("reads unknown keys in sentence case with units, dropping id suffixes", () => {
    expect(humanizeFieldName("biocharOutputKg")).toBe("Biochar output (kg)");
    expect(humanizeFieldName("distanceKm")).toBe("Distance (km)");
    expect(humanizeFieldName("electricityKwh")).toBe("Electricity (kWh)");
    expect(humanizeFieldName("totalCarbonPercent")).toBe("Total carbon (%)");
    expect(humanizeFieldName("storageLocationId")).toBe("Storage location");
    expect(humanizeFieldName("productionRunIds")).toBe("Production runs");
    expect(humanizeFieldName("site_management_notes")).toBe("Site management notes");
  });

  it("drops bookkeeping fields and repeats", () => {
    expect(activityChangedFieldLabels(item({ changedFields: ["version", "notes", "notes", "facilityId"] }))).toEqual(["Notes"]);
  });
});

describe("record names and meanings", () => {
  it("names a document by its type, even after it was deleted", () => {
    const reasonCode = "document:weighbridge_ticket:feedstock:feed-1";
    expect(activityRecordLabel(item({ entityType: "document", reasonCode, record: { label: null, deleted: true, facilityId: null } }))).toBe("Weighbridge ticket");
    expect(activityRecordLabel(item({ entityType: "document", record: { label: "Document", deleted: false, facilityId: null } }))).toBeNull();
    expect(activityRecordLabel(item())).toBe("PR-001");
  });

  it("explains run membership changes", () => {
    expect(activityChangeSummary(item({ reasonCode: "attached" }))).toBe("Added to this credit batch");
    expect(activityChangeSummary(item({ reasonCode: "detached" }))).toBe("Removed from this credit batch");
    expect(activityChangeSummary(item())).toBeNull();
  });

  it("keys statuses into the shared badge vocabulary, with a neutral readable fallback", () => {
    expect(toBadgeProps(activityStatusKey("VERIFIED"))).toEqual({ status: "verified" });
    expect(getStatusState(toBadgeProps(activityStatusKey("REJECTED")).status)).toBe("error");
    expect(toBadgeProps(activityStatusKey("in_review"))).toEqual({ status: "draft", label: "In review" });
  });
});

describe("record links", () => {
  it("opens each record's side sheet on the facility it lives at", () => {
    expect(activityRecordHref(item(), CONTEXT)).toBe("/production-runs?facility=facility-1&run=run-1");
    expect(activityRecordHref(item({ entityType: "feedstock", entityId: "f-1" }), CONTEXT)).toBe("/feedstocks?facility=facility-1&feedstock=f-1");
    expect(activityRecordHref(item({ entityType: "biochar_product", entityId: "p-1" }), CONTEXT)).toBe("/biochar-products?facility=facility-1&biocharProduct=p-1");
    expect(activityRecordHref(item({ entityType: "lab_sample", entityId: "s-1" }), CONTEXT)).toBe("/samples?facility=facility-1&sample=s-1");
    expect(activityRecordHref(item({ entityType: "delivery", entityId: "d-1" }), CONTEXT)).toBe("/deliveries?facility=facility-1&delivery=d-1");
    expect(activityRecordHref(item({ entityType: "application", entityId: "a-1" }), CONTEXT)).toBe("/applications?facility=facility-1&application=a-1");
    expect(activityRecordHref(item({ entityType: "removal", entityId: "r-1" }), CONTEXT)).toBe("/certification/removals?facility=facility-1&removal=r-1");
    expect(activityRecordHref(item({ entityType: "ghg_statement", entityId: "g-1" }), CONTEXT)).toBe("/certification/ghg-statements?facility=facility-1&statement=g-1");
    expect(activityRecordHref(item({ entityType: "credit_batch", entityId: "other" }), CONTEXT)).toBe("/credit-batches?facility=facility-1&batch=other");
    expect(activityRecordHref(item({ entityType: "order", entityId: "o-1" }), CONTEXT)).toBe("/orders?facility=facility-1&order=o-1");
  });

  it("follows a record that moved to another facility", () => {
    expect(activityRecordHref(item({ record: { ...live, facilityId: "facility-2" } }), CONTEXT))
      .toBe("/production-runs?facility=facility-2&run=run-1");
  });

  it("opens a document's owner, the sheet that holds its files", () => {
    expect(activityRecordHref(item({ entityType: "document", entityId: "doc-1", reasonCode: "document:lab_report:sample:s-1" }), CONTEXT))
      .toBe("/samples?facility=facility-1&sample=s-1");
  });

  it("links nothing for tombstones, unknown facilities, sheetless records and the batch itself", () => {
    expect(activityRecordHref(item({ record: { label: null, deleted: true, facilityId: null } }), CONTEXT)).toBeNull();
    expect(activityRecordHref(item({ record: { ...live, facilityId: null } }), CONTEXT)).toBeNull();
    for (const entityType of ["transport_leg", "bin_movement"] as const) {
      expect(activityRecordHref(item({ entityType }), CONTEXT)).toBeNull();
    }
    expect(activityRecordHref(item({ entityType: "credit_batch", entityId: BATCH }), CONTEXT)).toBeNull();
    expect(activityRecordHref(item({ entityType: "document", reasonCode: null }), CONTEXT)).toBeNull();
  });
});
