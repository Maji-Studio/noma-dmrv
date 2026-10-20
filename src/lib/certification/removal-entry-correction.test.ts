import { expect, it } from "vitest";
import { deriveEntryCorrection } from "./removal-entry-correction";
import type { EntryInputManifest } from "./removal-emission-contributions";
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
