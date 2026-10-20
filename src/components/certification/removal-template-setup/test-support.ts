import type { SetupAssignment, SetupComponent, SetupDecision, SetupDefault, SetupOption, RemovalTemplateSetupPlan } from "@/lib/certification/removal-template-setup-plan";
import type { SetupData, SetupTemplate } from "./setup-steps";

type Source = NonNullable<SetupAssignment["automaticSource"]>;

export function component(id: string, displayName: string): SetupComponent {
  return { component: { id, displayName, blueprintKey: "ghg_electricity" } as SetupComponent["component"], groupKey: "group", contract: undefined };
}

export const operating = (automaticSource?: Source, entryPolicy: SetupAssignment["entryPolicy"] = "none"): SetupAssignment => ({ scope: "operating", automaticSource, entryPolicy });

export function option(id: string, label: string, assignments: Record<string, SetupAssignment>): SetupOption {
  return { id, label, assignments };
}

export const PYROLYZER = component("pyrolyzer", "Pyrolyzer electricity usage");
export const PROCESSING = component("processing", "Biochar processing electricity usage");
export const FUEL = component("fuel", "Biomass processing fuel usage");

export const electricityClash: SetupDecision = {
  id: "clash:run-electricity", kind: "clash", components: [PYROLYZER, PROCESSING],
  options: [
    option("pyrolyzer", "Pyrolyzer electricity usage", { pyrolyzer: operating("run-electricity"), processing: operating(undefined, "additive") }),
    option("processing", "Biochar processing electricity usage", { processing: operating("run-electricity"), pyrolyzer: operating(undefined, "additive") }),
  ],
};

export const dieselSource: SetupDecision = {
  id: "fuel", kind: "source", components: [FUEL],
  options: [
    option("run-genset-diesel", "run-genset-diesel", { fuel: operating("run-genset-diesel") }),
    option("run-startup-diesel", "run-startup-diesel", { fuel: operating("run-startup-diesel") }),
    option("entry", "Neither, entry", { fuel: operating(undefined, "additive") }),
  ],
};

/** noma already gave startup diesel to this component, so the fuel decision cannot also take it. */
/** A component added after setup: noma's proposal first, nothing preselected. */
export const addedComponent: SetupDecision = {
  id: "added", kind: "added", components: [component("added", "Staff transport")],
  options: [
    option("entry", "Entry", { added: operating(undefined, "additive") }),
    option("run-electricity", "run-electricity", { added: operating("run-electricity") }),
  ],
};

export const startupDefault: SetupDefault = {
  ...component("startup", "Startup fuel usage"),
  proposal: option("run-startup-diesel", "run-startup-diesel", { startup: operating("run-startup-diesel") }),
  options: [
    option("run-startup-diesel", "run-startup-diesel", { startup: operating("run-startup-diesel") }),
    option("entry", "Entry", { startup: operating(undefined, "additive") }),
  ],
};

export function template(id: string, name: string, plan: Partial<RemovalTemplateSetupPlan> = {}, blockedReason: string | null = null): SetupTemplate {
  const full: RemovalTemplateSetupPlan = { decided: [], defaults: [], decisions: [], ...plan };
  return {
    id, name, componentCount: full.decided.length + full.defaults.length + full.decisions.reduce((sum, decision) => sum + decision.components.length, 0),
    plan: full, ready: full.decisions.length === 0, toDecideCount: full.decisions.length,
    semanticFingerprint: `${id}-semantic`, fullFingerprint: `${id}-full`, planFingerprint: `${id}-plan`, blockedReason,
  };
}

export function setupData(overrides: Partial<SetupData> = {}): SetupData {
  return {
    facility: { id: "11111111-1111-4111-8111-111111111111", name: "Mafinga Facility" },
    projectName: "Tanzania biochar", tier: "1000_year", fitting: [], notFitting: [],
    defaultRemovalTemplateId: null, defaultToDecideCount: 0,
    batchesWithoutTemplate: [
      { id: "22222222-2222-4222-8222-222222222222", code: "CB-26-001", version: 3 },
      { id: "33333333-3333-4333-8333-333333333333", code: "CB-26-002", version: 1 },
    ],
    batchesOnOtherTemplates: [], viewerCanManage: true, ...overrides,
  } as SetupData;
}
