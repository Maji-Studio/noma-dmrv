/** Why a row carries what it does, in words. Never a bare code, never a component ID, never the row's own name. */
import type { AllocationRecord } from "@/types/emission-allocation";
import { formatKg } from "./allocation-format";
import { basisFor, type Owner } from "./allocation-model";

/** The sentence under a "Goes to" row, or null when the row already says it all. */
export function basisSentence(record: AllocationRecord, owner: Owner): string | null {
  const sentences = basisFor(record, owner).flatMap((basis): string[] => {
    switch (basis.kind) {
      case "firstRun":
        return [`First completed run ${basis.label}`];
      case "load":
        return basis.kg === null ? [] : [`${formatKg(basis.kg)} on the load`];
      case "slice":
        return basis.kg === null ? [] : [`${formatKg(basis.kg)} of the load applied in it`];
      case "wouldClaim":
        return owner.surface === "removal" ? [`Would be sent with ${owner.label}`] : [];
      case "claim":
        return [record.group === "manual" ? `Sent with ${owner.label}` : "Claims the production of its batch"];
      case "notYet":
        if (record.group === "feedstockTransport") return ["No completed run has drawn from it"];
        if (record.group === "deliveryTransport" && basis.kg !== null) return [`${formatKg(basis.kg)} ${owner.surface === "removal" ? "not in a Removal" : "not on a credit batch"}`];
        return [];
      default:
        return [];
    }
  });
  return sentences.length ? [...new Set(sentences)].join(". ") : null;
}
