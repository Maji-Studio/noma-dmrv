import { buildRemovalSourceDescription } from "./removal-source-bindings";
import { describe, expect, it } from "vitest";
import { aggregatedProductionRunDatapointDescription, carriedEntryDatapointDescription, carriedEntrySourceDescription, DATAPOINT_DESCRIPTION_MAX_LENGTH, fitStoredDatapointDescription } from "./emission-entry-carry-copy";

function productionRunIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
}

describe("aggregatedProductionRunDatapointDescription", () => {
  it.each([0, 1, 12])("preserves the full description for %i runs when it fits", count => {
    const ids = productionRunIds(count);
    const description = aggregatedProductionRunDatapointDescription(ids);
    expect(description).toBe(`Aggregated from production runs ${ids.join(", ")}`);
    expect(description.length).toBeLessThanOrEqual(DATAPOINT_DESCRIPTION_MAX_LENGTH);
  });

  it("preserves a description that exactly fills the limit", () => {
    const prefix = "Aggregated from production runs ";
    const ids = ["x".repeat(DATAPOINT_DESCRIPTION_MAX_LENGTH - prefix.length)];
    const description = aggregatedProductionRunDatapointDescription(ids);
    expect(description).toBe(`${prefix}${ids[0]}`);
    expect(description.length).toBe(DATAPOINT_DESCRIPTION_MAX_LENGTH);
  });

  it.each([14, 200])("lists as many of %i UUID runs as fit and counts the remainder", count => {
    const ids = productionRunIds(count);
    const description = aggregatedProductionRunDatapointDescription(ids);
    expect(description.length).toBeLessThanOrEqual(DATAPOINT_DESCRIPTION_MAX_LENGTH);
    const match = description.match(/^Aggregated from (\d+) production runs: (.*) and (\d+) more$/);
    expect(match).not.toBeNull();
    const [, total, listed, remaining] = match!;
    const listedIds = listed.split(", ");
    expect(Number(total)).toBe(count);
    expect(listedIds).toEqual(ids.slice(0, listedIds.length));
    expect(Number(remaining)).toBeGreaterThan(0);
    expect(listedIds.length + Number(remaining)).toBe(count);
    const nextCandidate = `Aggregated from ${count} production runs: ${ids.slice(0, listedIds.length + 1).join(", ")} and ${Number(remaining) - 1} more`;
    expect(nextCandidate.length).toBeGreaterThan(DATAPOINT_DESCRIPTION_MAX_LENGTH);
  });
});

describe("fitStoredDatapointDescription", () => {
  const STORED_RUN_COUNT = 14;

  it.each(["", "Recorded emissions entries", "Aggregated from production runs run-1", "x".repeat(DATAPOINT_DESCRIPTION_MAX_LENGTH)])("preserves descriptions within the cap: %s", description => {
    expect(fitStoredDatapointDescription(description)).toBe(description);
  });

  it("fits a stored aggregate exactly like a fresh build", () => {
    const ids = productionRunIds(STORED_RUN_COUNT);
    const storedDescription = `Aggregated from production runs ${ids.join(", ")}`;
    expect(storedDescription.length).toBeGreaterThan(DATAPOINT_DESCRIPTION_MAX_LENGTH);

    const description = fitStoredDatapointDescription(storedDescription);
    expect(description).toBe(aggregatedProductionRunDatapointDescription(ids));
    expect(description.length).toBeLessThanOrEqual(DATAPOINT_DESCRIPTION_MAX_LENGTH);
  });

  it("slices unknown over-cap text without an ellipsis", () => {
    const storedDescription = "x".repeat(DATAPOINT_DESCRIPTION_MAX_LENGTH + 1);
    expect(fitStoredDatapointDescription(storedDescription)).toBe("x".repeat(DATAPOINT_DESCRIPTION_MAX_LENGTH));
  });
});

const entry = { entryId: "e", creditBatchCode: "CB-26-009", occurredOn: "2026-09-14", value: { magnitude: "120.00", unit: "L" }, earlierRemovalCode: "RM-009" };
it("identifies the original batch and use date in both verifier notes", () => {
  expect(carriedEntryDatapointDescription([entry])).toBe("Recorded emissions entries. Includes 120 L used on Sep 14, 2026 for credit batch CB-26-009, recorded after its Removal RM-009 was sent.");
  expect(carriedEntrySourceDescription(entry)).toBe("credit batch CB-26-009, used Sep 14, 2026");
  expect(carriedEntryDatapointDescription([])).toBe("Recorded emissions entries");
});
it("caps deterministically at 500 characters without cutting a sentence", () => {
  const entries = Array.from({ length: 20 }, (_, index) => ({ ...entry, entryId: String(index) }));
  const text = carriedEntryDatapointDescription(entries);
  expect(text.length).toBeLessThanOrEqual(DATAPOINT_DESCRIPTION_MAX_LENGTH);
  expect(text).toMatch(/And \d+ more entries from credit batches\.$/);
  expect(carriedEntryDatapointDescription(entries.reverse())).toBe(text);
  expect(carriedEntryDatapointDescription([{ ...entry, creditBatchCode: "x".repeat(600) }]).length).toBeLessThanOrEqual(DATAPOINT_DESCRIPTION_MAX_LENGTH);
});

it("includes the carry context in the actual Source description", () => {
  expect(buildRemovalSourceDescription({ nomaRole: "emission_entry", nomaRoleLabel: "Emissions entry",
    lineage: { entityType: "emission_entry", entityId: "e", entityLabel: "Emissions entry" },
    intendedTarget: { kind: "explicit", componentId: "diesel", inputKey: "fuel" }, mappingRevision: "revision", carriedEntry: entry,
  })).toBe("Noma role: Emissions entry. Lineage: Emissions entry, credit batch CB-26-009, used Sep 14, 2026.");
});
