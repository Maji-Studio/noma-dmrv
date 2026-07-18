/** Shared Flow Hero view union — the segmented control's smart views. */
export type FlowHeroView = "overview" | "flow" | "attention";

export const FLOW_HERO_VIEWS: { value: FlowHeroView; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "flow", label: "Flow" },
  { value: "attention", label: "Needs attention" },
];
