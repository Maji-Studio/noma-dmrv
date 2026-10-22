import { buildRemovalSourceDescription } from "./removal-source-bindings";
import { expect, it } from "vitest";
import { carriedEntryDatapointDescription, carriedEntrySourceDescription, DATAPOINT_DESCRIPTION_MAX_LENGTH } from "./emission-entry-carry-copy";
const entry = { entryId: "e", creditBatchCode: "CB-26-009", occurredOn: "2026-09-14", value: { magnitude: "120.00", unit: "L" }, earlierRemovalCode: "RM-009" };
it("identifies the original batch and use date in both verifier notes", () => {
  expect(carriedEntryDatapointDescription([entry])).toBe("Recorded emissions entries. Includes 120 L used on Sep 14, 2026 for earlier credit batch CB-26-009, recorded after its Removal RM-009 was sent.");
  expect(carriedEntrySourceDescription(entry)).toBe("credit batch CB-26-009, used Sep 14, 2026");
  expect(carriedEntryDatapointDescription([])).toBe("Recorded emissions entries");
});
it("caps deterministically at 500 characters without cutting a sentence", () => {
  const entries = Array.from({ length: 20 }, (_, index) => ({ ...entry, entryId: String(index) }));
  const text = carriedEntryDatapointDescription(entries);
  expect(text.length).toBeLessThanOrEqual(DATAPOINT_DESCRIPTION_MAX_LENGTH);
  expect(text).toMatch(/And \d+ more entries from earlier credit batches\.$/);
  expect(carriedEntryDatapointDescription(entries.reverse())).toBe(text);
  expect(carriedEntryDatapointDescription([{ ...entry, creditBatchCode: "x".repeat(600) }]).length).toBeLessThanOrEqual(DATAPOINT_DESCRIPTION_MAX_LENGTH);
});

it("includes the carry context in the actual Source description", () => {
  expect(buildRemovalSourceDescription({ nomaRole: "emission_entry", nomaRoleLabel: "Emissions entry",
    lineage: { entityType: "emission_entry", entityId: "e", entityLabel: "Emissions entry" },
    intendedTarget: { kind: "explicit", componentId: "diesel", inputKey: "fuel" }, mappingRevision: "revision", carriedEntry: entry,
  })).toBe("Noma role: Emissions entry. Lineage: Emissions entry, credit batch CB-26-009, used Sep 14, 2026.");
});
