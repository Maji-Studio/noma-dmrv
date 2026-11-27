/** Live saved-record attachment, separate from material membership and form previews. */
export interface FailedRunEmissionGuidance {
  productionRunId: string;
  runCode: string;
  facilityId: string;
  endDay: string | null;
  feedstockTypeId: string | null;
  feedstockTypeName: string | null;
  state: "attached" | "no-match" | "mixed-feedstock" | "empty-feedstock";
  batch: { id: string; code: string } | null;
  href: string;
}
