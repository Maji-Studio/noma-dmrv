/** The wording of the Allocation section. Rules are the picked ones (#1534); no CO2e anywhere. */
import type { GroupKey } from "@/types/emission-allocation";

export const GROUP_COPY: Record<GroupKey, { title: string; rule: string }> = {
  feedstockTransport: {
    title: "Feedstock transport",
    rule: "A feedstock delivery's whole transport goes to the credit batch whose first completed production run drew from it. Other batches that drew from it show Counted on. Lost mass never counts. A delivery no run drew from is not yet allocated.",
  },
  production: {
    title: "Production runs",
    rule: "A production run belongs to one credit batch, so its diesel and electricity go to that batch in full.",
  },
  deliveryTransport: {
    title: "Biochar delivery transport",
    rule: "A biochar delivery is split by the biochar mass each credit batch has on the load.",
  },
  manual: {
    title: "Manual entries",
    rule: "A manual entry is recorded on one credit batch and stays with it in full.",
  },
};

/** On a Removal the shares come from what it claims or sends, not from batch splits. */
const REMOVAL_RULES: Record<GroupKey, string> = {
  feedstockTransport: "A feedstock delivery's whole transport goes with the Removal that claims the production of the batch whose first completed run drew from it. Lost mass never counts.",
  production: "A production run goes with the Removal that claims the production of its credit batch.",
  deliveryTransport: "A biochar delivery is split by the biochar each Removal's applications took from the load.",
  manual: "A manual entry goes with the Removal that sends it for its credit batch.",
};

export function groupRule(group: GroupKey, surface: "batch" | "removal"): string {
  return surface === "removal" ? REMOVAL_RULES[group] : GROUP_COPY[group].rule;
}

export const SECTION_TITLE = "Allocation";

export function sectionHint(surface: "batch" | "removal"): string {
  const owner = surface === "batch" ? "credit batch" : "Removal";
  return `Each record that causes emissions is counted once, on the ${owner} that carries it. noma sends the quantities and Isometric works out the emissions.`;
}
