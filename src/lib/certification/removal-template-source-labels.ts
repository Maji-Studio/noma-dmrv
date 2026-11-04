import type { AutomaticSourceId } from "@/lib/isometric/template-observations/catalog-sources";

export const SOURCE_LABELS: Record<AutomaticSourceId, string> = {
  "run-genset-diesel": "Generator diesel from production runs",
  "run-startup-diesel": "Startup diesel from production runs",
  "run-electricity": "Electricity from production runs",
  "feedstock-transport": "Feedstock transport legs",
  "delivery-transport": "Delivery transport legs",
  "sample-transport": "Sample transport legs",
  "feedstock-dry-mass": "Feedstock dry mass",
  "biochar-dry-mass": "Biochar dry mass",
  sequestration: "Applications and lab results",
  "safety-margin": "Safety margin on biochar dry mass",
};
