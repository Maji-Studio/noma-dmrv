/**
 * PROTOTYPE (#1276), not for merge. Hardcoded Removal template setup data,
 * modelled on the sandbox project "Tanzania biochar" and the seeded Mafinga
 * facility. Two scenarios:
 *
 * - `ready`: one template fits the facility's durability tier and noma can
 *   decide every component, so setup is a confirmation.
 * - `protocol`: two templates fit; the recommended one ("Protocol default")
 *   leaves two decisions noma cannot make (a clash and an ambiguous source).
 */

export type ScenarioKey = "ready" | "protocol";

export interface DecisionOption {
  value: string;
  title: string;
  /** What picking it changes, in one line. */
  description: string;
}

export interface OpenDecision {
  id: string;
  kind: "clash" | "source";
  /** The question, as the operator would ask it. */
  question: string;
  /** Two short sentences: why noma cannot decide. */
  situation: string;
  options: DecisionOption[];
  /** The short answer once decided, shown on the summary. */
  answerLabel: (value: string) => string;
}

export interface DefaultDecision {
  component: string;
  group: string;
  /** What fills it: a noma record source, or an emissions entry per batch. */
  fill: "records" | "entry";
  /** The noma records, when `fill` is "records". */
  source?: string;
  /** Direct emissions must be recorded on every credit batch. */
  requiredEachBatch?: boolean;
}

export interface TemplateOption {
  id: string;
  name: string;
  componentCount: number;
  decisions: OpenDecision[];
  defaults: DefaultDecision[];
  /** Why noma recommends it, when it does. */
  recommendedReason?: string;
}

export interface Scenario {
  key: ScenarioKey;
  projectName: string;
  durability: string;
  fitting: TemplateOption[];
  /** Templates in the project that do not fit, with the reason. */
  notFitting: { name: string; reason: string }[];
  batchesWithoutTemplate: string[];
  batchesWithTemplate: { code: string; template: string }[];
}

export const FACILITY_NAME = "Mafinga Facility";
export const ORGANIZATION_NAME = "Dark Earth Carbon";

const ELECTRICITY_CLASH: OpenDecision = {
  id: "electricity",
  kind: "clash",
  question: "Which component gets the electricity from production runs?",
  situation:
    "noma records one electricity figure per production run. Two components in this template measure electricity, and one figure cannot fill both.",
  options: [
    {
      value: "pyrolyzer",
      title: "Pyrolyzer electricity usage",
      description: "Pyrolysis, kWh. Biochar processing electricity usage then takes an emissions entry on each credit batch.",
    },
    {
      value: "processing",
      title: "Biochar processing electricity usage",
      description: "Biochar processing, kWh. Pyrolyzer electricity usage then takes an emissions entry on each credit batch.",
    },
  ],
  answerLabel: (value) =>
    value === "processing" ? "Electricity from production runs fills Biochar processing electricity usage" : "Electricity from production runs fills Pyrolyzer electricity usage",
};

const DIESEL_SOURCE: OpenDecision = {
  id: "diesel",
  kind: "source",
  question: "Which diesel fills Biomass processing fuel usage?",
  situation:
    "Production runs record generator diesel and startup diesel separately. The component name does not say which one it means.",
  options: [
    {
      value: "generator",
      title: "Generator diesel",
      description: "From production runs, in litres.",
    },
    {
      value: "startup",
      title: "Startup diesel",
      description: "From production runs, in litres.",
    },
    {
      value: "entry",
      title: "Neither",
      description: "Record it as an emissions entry on each credit batch.",
    },
  ],
  answerLabel: (value) =>
    value === "startup"
      ? "Startup diesel fills Biomass processing fuel usage"
      : value === "entry"
        ? "Biomass processing fuel usage takes an emissions entry on each credit batch"
        : "Generator diesel fills Biomass processing fuel usage",
};

const TRANSPORT_CLASH: OpenDecision = {
  id: "transport",
  kind: "clash",
  question: "Which component gets the feedstock transport legs?",
  situation:
    "Two components in this template measure feedstock transport by truck. Each transport leg can count once only.",
  options: [
    {
      value: "processing-site",
      title: "Biomass transportation to processing site via truck",
      description: "Last mile feedstock transport then takes an emissions entry on each credit batch.",
    },
    {
      value: "last-mile",
      title: "Last mile feedstock transport",
      description: "Biomass transportation to processing site via truck then takes an emissions entry on each credit batch.",
    },
  ],
  answerLabel: (value) =>
    value === "last-mile" ? "Feedstock transport legs fill Last mile feedstock transport" : "Feedstock transport legs fill Biomass transportation to processing site via truck",
};

const PROTOCOL_DEFAULTS: DefaultDecision[] = [
  { component: "CO₂ stored from biochar application", group: "CO₂ stored", fill: "records", source: "Applications and lab results" },
  { component: "Biomass transportation to processing site via truck", group: "Biomass feedstock transport", fill: "records", source: "Feedstock transport legs" },
  { component: "Biomass transportation to truck via loader", group: "Biomass feedstock transport", fill: "records", source: "Feedstock dry mass" },
  { component: "Biochar transportation to storage site via truck", group: "Biochar transport", fill: "records", source: "Delivery transport legs" },
  { component: "Biochar transportation to tractor via loader", group: "Biochar transport", fill: "records", source: "Biochar dry mass" },
  { component: "Pyrolyzer CH₄ emissions", group: "Direct emissions", fill: "entry", requiredEachBatch: true },
  { component: "Pyrolyzer CO emissions", group: "Direct emissions", fill: "entry", requiredEachBatch: true },
  { component: "Biomass handling equipment fuel usage", group: "Biomass feedstock sourcing", fill: "entry" },
  { component: "Biomass handling equipment natural gas usage", group: "Biomass feedstock sourcing", fill: "entry" },
  { component: "Biochar application via tractor", group: "Biochar storage", fill: "entry" },
  { component: "Laboratory analysis electricity use", group: "Sampling required for MRV", fill: "entry" },
  { component: "Sample transportation via car", group: "Sampling required for MRV", fill: "entry" },
  { component: "Sampling consumables", group: "Sampling required for MRV", fill: "entry" },
  { component: "Staff travel", group: "Staff travel", fill: "entry" },
];

const DARK_EARTH_DEFAULTS: DefaultDecision[] = PROTOCOL_DEFAULTS.filter(
  (row) => !row.component.startsWith("Biomass transportation"),
);

const READY_DEFAULTS: DefaultDecision[] = [
  { component: "CO₂ stored from biochar application", group: "CO₂ stored", fill: "records", source: "Applications and lab results" },
  { component: "Generator diesel usage", group: "Pyrolysis", fill: "records", source: "Generator diesel from production runs" },
  { component: "Startup diesel usage", group: "Pyrolysis", fill: "records", source: "Startup diesel from production runs" },
  { component: "Pyrolyzer electricity usage", group: "Pyrolysis", fill: "records", source: "Electricity from production runs" },
  { component: "Feedstock transport by truck", group: "Biomass feedstock transport", fill: "records", source: "Feedstock transport legs" },
  { component: "Biochar transport by truck", group: "Biochar transport", fill: "records", source: "Delivery transport legs" },
  { component: "Feedstock loading", group: "Biomass feedstock transport", fill: "records", source: "Feedstock dry mass" },
  { component: "Biochar loading", group: "Biochar transport", fill: "records", source: "Biochar dry mass" },
  { component: "Pyrolyzer CH₄ emissions", group: "Direct emissions", fill: "entry", requiredEachBatch: true },
  { component: "Pyrolyzer CO emissions", group: "Direct emissions", fill: "entry", requiredEachBatch: true },
  { component: "Biochar application via tractor", group: "Biochar storage", fill: "entry" },
  { component: "Laboratory analysis electricity use", group: "Sampling required for MRV", fill: "entry" },
  { component: "Sample transportation via car", group: "Sampling required for MRV", fill: "entry" },
  { component: "Sampling consumables", group: "Sampling required for MRV", fill: "entry" },
  { component: "Staff travel", group: "Staff travel", fill: "entry" },
];

const PROTOCOL_DEFAULT_TEMPLATE: TemplateOption = {
  id: "rtc_protocol_default",
  name: "Protocol default",
  componentCount: 17,
  decisions: [ELECTRICITY_CLASH, DIESEL_SOURCE],
  defaults: PROTOCOL_DEFAULTS,
  recommendedReason: "Fewest decisions left",
};

const DARK_EARTH_TEMPLATE: TemplateOption = {
  id: "rtc_dark_earth",
  name: "Dark Earth removal template",
  componentCount: 17,
  decisions: [ELECTRICITY_CLASH, DIESEL_SOURCE, TRANSPORT_CLASH],
  defaults: DARK_EARTH_DEFAULTS,
};

const READY_TEMPLATE: TemplateOption = {
  id: "rtc_15_oct",
  name: "Dark Earth Carbon Template (15 Oct)",
  componentCount: 15,
  decisions: [],
  defaults: READY_DEFAULTS,
};

export const SCENARIOS: Record<ScenarioKey, Scenario> = {
  ready: {
    key: "ready",
    projectName: "Tanzania biochar",
    durability: "1000-year durability",
    fitting: [READY_TEMPLATE],
    notFitting: [],
    batchesWithoutTemplate: ["CB-26-001", "CB-26-002", "CB-26-003"],
    batchesWithTemplate: [],
  },
  protocol: {
    key: "protocol",
    projectName: "Tanzania biochar",
    durability: "1000-year durability",
    fitting: [PROTOCOL_DEFAULT_TEMPLATE, DARK_EARTH_TEMPLATE],
    notFitting: [{ name: "Biochar 200-year sampled", reason: "Built for 200-year durability" }],
    batchesWithoutTemplate: ["CB-26-001", "CB-26-002", "CB-26-003"],
    batchesWithTemplate: [{ code: "CB-25-014", template: "Dark Earth removal template" }],
  },
};

export function parseScenario(value: string | null | undefined): ScenarioKey {
  return value === "ready" ? "ready" : "protocol";
}

export function recommendedTemplate(scenario: Scenario): TemplateOption {
  return scenario.fitting[0];
}

export function entryCount(template: TemplateOption, answers: Record<string, string>): number {
  // Components the operator will fill by hand on each credit batch: noma's
  // entry defaults, plus the components a decision leaves without records.
  const base = template.defaults.filter((row) => row.fill === "entry").length;
  const fromDecisions = template.decisions.filter((decision) => decision.kind === "clash" || answers[decision.id] === "entry").length;
  return base + fromDecisions;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
