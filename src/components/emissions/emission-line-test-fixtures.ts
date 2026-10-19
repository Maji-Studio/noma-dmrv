/** Test-only builders for emission lines and entries (no DB). */
import type { EmissionEntry, EmissionLine } from "./emission-line-display";

const CREATED_AT = new Date("2026-10-02T09:00:00Z");

export function makeEntry(overrides: Partial<EmissionEntry> = {}): EmissionEntry {
  return {
    id: "entry-1",
    componentId: "line-1",
    kind: "value",
    occurredOn: "2026-09-12",
    note: null,
    version: 1,
    counts: true,
    canConfirm: true,
    reason: null,
    hasEvidence: true,
    documentCount: 1,
    confirmedForRemovalId: null,
    createdAt: CREATED_AT,
    values: [{ inputKey: "energy", magnitude: "42.5", unit: "kWh", massDistanceDetail: null }],
    total: { magnitude: "42.5", unit: "kWh" },
    ...overrides,
  } as EmissionEntry;
}

export function makeLine(overrides: Partial<EmissionLine> = {}): EmissionLine {
  return {
    componentId: "line-1",
    displayName: "Metered electricity use emissions",
    label: "Metered electricity use emissions",
    groupKey: "pyrolysis",
    groupName: "Pyrolysis",
    groupPosition: 0,
    position: 0,
    blueprintKey: "grid_electricity_use",
    description: null,
    contract: { scope: "operating", entryPolicy: "additive" },
    entryPolicy: "additive",
    state: "empty",
    automaticFigure: null,
    records: null,
    entries: [],
    total: null,
    unit: "kWh",
    inputShape: [{ key: "energy", type: "monitored", quantityKind: "energy", unit: "kWh" }],
    ...overrides,
  } as EmissionLine;
}
