import { expect, it } from "vitest";
import { deriveEntryCorrection } from "./removal-entry-correction";
import { entryInputManifestSchema, type EntryInputManifest } from "./removal-emission-contributions";
const manifest: EntryInputManifest[] = [{ componentId: "diesel", inputKey: "fuel", entries: [{ entryId: "entry", creditBatchId: "batch", contentRevision: 1, kind: "value", value: { magnitude: "2", unit: "L" }, evidenceDocumentIds: ["file"] }] }];
it("requires an open window, including when the sent entry was deleted", () => {
  expect(deriveEntryCorrection(false, manifest, []).correctionNeeded).toBe(false);
  expect(deriveEntryCorrection(true, manifest, []).changedComponentIds).toEqual(["diesel"]);
});
it("detects new entries and counts components once across paired inputs", () => {
  expect(deriveEntryCorrection(true, [], [...manifest, { ...manifest[0], inputKey: "other" }]).changedComponentIds).toEqual(["diesel"]);
});
it.each(["revision", "files", "value"])("detects %s changes", (change) => {
  const current = structuredClone(manifest);
  if (change === "revision") current[0].entries[0].contentRevision++;
  if (change === "files") current[0].entries[0].evidenceDocumentIds = ["other"];
  if (change === "value") current[0].entries[0].value.magnitude = "3";
  expect(deriveEntryCorrection(true, manifest, current).message).toBe("Correction needed: 1 component changed since this Removal was sent.");
});
it("ignores display labels and unchanged contributions", () => {
  expect(deriveEntryCorrection(true, manifest, [{ ...manifest[0], componentDisplayName: "Renamed" }]).correctionNeeded).toBe(false);
});

it("attributes a changed component only to the batch whose contribution changed", () => {
  const previous = [{ ...manifest[0], entries: [...manifest[0].entries, { ...manifest[0].entries[0], entryId: "other", creditBatchId: "unchanged" }] }];
  const current = structuredClone(previous);
  current[0].entries[0].contentRevision++;
  expect(deriveEntryCorrection(true, previous, current).changedBatchIds).toEqual(["batch"]);
  expect(deriveEntryCorrection(true, previous, [{ ...previous[0], entries: [previous[0].entries[1]] }]).changedBatchIds).toEqual(["batch"]);
});

it("ignores figure key order after snapshot parsing but detects changed transport values", () => {
  const live: EntryInputManifest = {
    componentId: "shipping", inputKey: "mass_distance", componentDisplayName: "Shipping",
    entries: [{
      entryId: "entry", creditBatchId: "batch", creditBatchCode: "B001", contentRevision: 1,
      kind: "value", occurredOn: "2026-10-01", value: { unit: "t.km", magnitude: "6" },
      massDistanceDetail: {
        distance: { unit: "km", magnitude: "3" }, mass: { unit: "t", magnitude: "2" },
      },
      evidenceDocumentIds: ["file"],
    }],
  };
  const snapshot = entryInputManifestSchema.parse(live);
  expect(snapshot).toEqual(live);
  expect(JSON.stringify(snapshot.entries[0].value)).not.toBe(JSON.stringify(live.entries[0].value));
  expect(deriveEntryCorrection(true, [snapshot], [live])).toMatchObject({
    correctionNeeded: false, changedComponentIds: [], changedBatchIds: [], message: null,
  });
  for (const figure of ["value", "mass", "distance"] as const) {
    const changed = structuredClone(live);
    const value = figure === "value" ? changed.entries[0].value : changed.entries[0].massDistanceDetail![figure];
    value.magnitude = "7";
    expect(deriveEntryCorrection(true, [snapshot], [changed])).toMatchObject({
      correctionNeeded: true, changedComponentIds: ["shipping"], changedBatchIds: ["batch"],
    });
  }
});
