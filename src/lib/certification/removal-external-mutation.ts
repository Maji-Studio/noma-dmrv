/**
 * Sticky Removal-level marker written by the submit path before any ledger
 * row exists, when Source mirroring is about to open the registry boundary.
 * Read by Removal deletion (role floor) and by both delete surfaces (gate
 * and copy) so client and server agree on which Removals may have registry
 * exposure without a ledger row.
 */
export const REMOVAL_EXTERNAL_MUTATION_POSSIBLE_KEY =
  "submissionExternalMutationPossible";

export function removalMayHaveExternalMutation(metadata: unknown): boolean {
  return (
    metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>)[
      REMOVAL_EXTERNAL_MUTATION_POSSIBLE_KEY
    ] === true
  );
}
