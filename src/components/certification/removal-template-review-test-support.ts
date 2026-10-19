/**
 * Tests only. One listed Removal template for the line review: a proposed
 * startup diesel line and a reviewed lab line, with the stored definition and
 * contracts the server returns behind them.
 */
import {
  ownValue, PYROLYSIS_DIESEL_SPLIT, SEMANTIC_BINDING_CATALOG,
} from "@/lib/isometric/semantic-binding-catalog";
import type { RemovalTemplateReviewEntry } from "./removal-template-review-model";

/** The catalog's pyrolysis diesel binding, so the startup line takes startup diesel as a candidate. */
const [DIESEL_BLUEPRINT, DIESEL_INPUT] = Object.entries(SEMANTIC_BINDING_CATALOG).flatMap(([blueprint, inputs]) =>
  Object.entries(inputs).flatMap(([input, binding]) => {
    const role = ownValue(binding.roles, "pyrolysis");
    return role && "disambiguation" in role && role.disambiguation === PYROLYSIS_DIESEL_SPLIT ? [[blueprint, input] as const] : [];
  }),
)[0];

export const OBSERVATION_ID = "22222222-2222-4222-8222-222222222222";

export function component(id: string, displayName: string) {
  return {
    id, displayName, description: null, blueprintKey: DIESEL_BLUEPRINT,
    inputs: [{ key: DIESEL_INPUT, type: "monitored", quantityKind: "volume" }],
  };
}

function baseEntry(overrides: Record<string, unknown>): RemovalTemplateReviewEntry {
  return {
    templateId: "rvt_test",
    template: { id: "rvt_test", display_name: "Dark Earth Carbon Template", credit_type: "REMOVAL" },
    observation: { id: OBSERVATION_ID, version: 3, enrichment: { cmp_startup: { [DIESEL_INPUT]: { unit: "L" } } } },
    enrichment: { cmp_startup: { [DIESEL_INPUT]: { unit: "L" } } },
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
