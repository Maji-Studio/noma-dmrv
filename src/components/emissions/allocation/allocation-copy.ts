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

export const SECTION_TITLE = "Allocation";

export function sectionHint(surface: "batch" | "removal"): string {
  const across = surface === "batch" ? "a credit batch" : "a Removal";
  return `Each record that causes emissions is counted once. A feedstock delivery's whole transport goes to the credit batch whose first completed run drew from it; a biochar delivery is split by the biochar each batch has on the load. What ${across} carries adds up here. Hatched is not yet allocated. noma sends the quantities and Isometric works out the emissions.`;
}
