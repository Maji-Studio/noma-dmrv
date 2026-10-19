/**
 * Tests only. One listed Removal template for the line review: a proposed
 * startup diesel line and a reviewed lab line, with the stored definition and
 * contracts the server returns behind them.
 */
import type { RemovalTemplateReviewEntry } from "./removal-template-review-model";

export const OBSERVATION_ID = "22222222-2222-4222-8222-222222222222";

export function component(id: string, displayName: string) {
  return {
    id, displayName, description: null, blueprintKey: "fuel_usage_by_volume",
    inputs: [{ key: "volume_of_fuel", type: "monitored", quantityKind: "volume" }],
  };
}

function baseEntry(overrides: Record<string, unknown>): RemovalTemplateReviewEntry {
  return {
    templateId: "rvt_test",
    template: { id: "rvt_test", display_name: "Dark Earth Carbon Template", credit_type: "REMOVAL" },
    observation: { id: OBSERVATION_ID, version: 3, enrichment: { cmp_startup: { volume_of_fuel: { unit: "L" } } } },
    enrichment: { cmp_startup: { volume_of_fuel: { unit: "L" } } },
    preview: false,
    isDefault: true,
    availability: "listed",
    changes: {},
    lines: [
      {
        component: component("cmp_startup", "Startup diesel usage"), groupKey: "pyrolysis", groupName: "Operations",
        contract: { scope: "operating", automaticSource: "run-startup-diesel", entryPolicy: "additive", origin: "proposed" },
        catalogCandidates: ["run-startup-diesel"], allowedEntryPolicies: ["none", "additive"], change: "added",
      },
      {
        component: component("cmp_lab", "Lab electricity"), groupKey: "pyrolysis", groupName: "Operations",
        contract: { scope: "operating", entryPolicy: "additive", origin: "reviewed" },
        catalogCandidates: [], allowedEntryPolicies: ["none", "additive"], change: "unchanged",
      },
    ],
    enrichmentProblems: [],
    lineSourceProblems: [{ code: "unassigned", componentId: "cmp_startup" }],
    ...overrides,
  } as unknown as RemovalTemplateReviewEntry;
}

/** The stored definition and contracts behind the lines, as the server returns them. */
export function entry(overrides: Record<string, unknown> = {}): RemovalTemplateReviewEntry {
  const base = baseEntry(overrides);
  if (!base.observation) return base;
  const groups = new Map<string, RemovalTemplateReviewEntry["lines"]>();
  for (const line of base.lines) groups.set(line.groupKey, [...(groups.get(line.groupKey) ?? []), line]);
  const definition = {
    groups: [...groups].map(([key, lines]) => ({
      id: key, key, displayName: lines[0].groupName, description: "", components: lines.map((line) => line.component),
    })),
  };
  const lineSources = Object.fromEntries(base.lines.map((line) => [line.component.id, line.contract]));
  return { ...base, observation: { ...base.observation, definition, lineSources } } as RemovalTemplateReviewEntry;
}
