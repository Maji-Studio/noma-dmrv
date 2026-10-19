import type { LineSources } from "./line-sources";

/** Tests only. Real acceptance requires the Owner/Admin change-review action. */
export function acceptAllProposals(lineSources: LineSources): LineSources {
  return Object.fromEntries(Object.entries(lineSources).map(([id, contract]) => [
    id, { ...contract, origin: contract.origin === "proposed" ? "reviewed" : contract.origin },
  ]));
}
