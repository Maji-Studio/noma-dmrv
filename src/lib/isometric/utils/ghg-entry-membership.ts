/**
 * Pure GHG-statement ↔ Removal membership reconciliation.
 *
 * Isometric decides which GHG entries (our Removals) a GHG Statement absorbs
 * server-side (by reporting-period date range) and returns them as
 * `GhgStatement.ghg_entry_ids` (the old `removal_ids` field is deprecated).
 * This decides how that remote membership maps onto local `certifier_removals`
 * rows: which to stamp, which are already linked, and where the two sides
 * have drifted. It never steals a removal already owned by another statement.
 *
 * No I/O. The data-access layer supplies the ledger + current-membership
 * lookups and applies the resulting `toLink` writes inside a transaction.
 */

export interface RemovalMembershipInput {
  /** Isometric ghg_entry ids the statement absorbed (`GhgStatement.ghg_entry_ids`). */
  externalRemovalIds: string[];
  /** Isometric removal id → local certifier_removals id, from the ledger. */
  externalToLocal: Map<string, string>;
  /** Local removal id → its current ghg_statement_id (null = unlinked). */
  currentMembership: Map<string, string | null>;
  /** The statement being reconciled. */
  ghgStatementId: string;
}

export interface RemovalMembershipDecision {
  /** Local removal ids to stamp with `ghgStatementId`. */
  toLink: string[];
  /** Local removal ids now linked to this statement (newly stamped + already). */
  linkedRemovalIds: string[];
  /** Drift notes for the operator. */
  warnings: string[];
}

export function decideRemovalMembership(
  input: RemovalMembershipInput,
): RemovalMembershipDecision {
  const {
    externalRemovalIds,
    externalToLocal,
    currentMembership,
    ghgStatementId,
  } = input;
  const warnings: string[] = [];

  // Derive the candidate local-removal set strictly from the external ids
  // requested for this reconciliation — any extras already in the
  // externalToLocal map (e.g., a caller pre-loaded a wider ledger window)
  // are ignored. This keeps the decision tightly anchored to
  // `externalRemovalIds` so a stale or oversized mapping cannot accidentally
  // link removals outside what Isometric actually returned for this
  // statement.
  const seen = new Set<string>();
  const localRemovalIds: string[] = [];
  for (const externalId of externalRemovalIds) {
    const localId = externalToLocal.get(externalId);
    if (localId === undefined) {
      // No local ledger row → drift.
      warnings.push(
        `Isometric linked Removal ${externalId}, but it is not saved in noma. Sync the GHG Statement again.`,
      );
      continue;
    }
    if (seen.has(localId)) continue;
    seen.add(localId);
    localRemovalIds.push(localId);
  }

  const toLink: string[] = [];
  const linkedRemovalIds: string[] = [];

  for (const removalId of localRemovalIds) {
    if (!currentMembership.has(removalId)) {
      // The ledger row points at a removal that no longer exists.
      warnings.push(
        `Removal ${removalId} has a submission record but no removal row.`,
      );
      continue;
    }
    const existing = currentMembership.get(removalId) ?? null;
    if (existing === null) {
      // Unlinked — claim it.
      toLink.push(removalId);
      linkedRemovalIds.push(removalId);
    } else if (existing === ghgStatementId) {
      // Already linked to this statement — idempotent.
      linkedRemovalIds.push(removalId);
    } else {
      // Owned by a different statement — never steal it.
      warnings.push(
        `Removal ${removalId} is already linked to a different GHG Statement; left unchanged.`,
      );
    }
  }

  return { toLink, linkedRemovalIds, warnings };
}

/** A removal the operator expected in a period, with its registry-facing id. */
export interface ExpectedRemoval {
  /** Local certifier_removals id. */
  localId: string;
  /** Isometric removal id (rmv_…) — what the operator recognises. */
  externalId: string;
}

/**
 * The honesty delta the reconciliation itself can't see: removals the operator
 * expected in this period (predicted in-window at create time) that Isometric
 * did *not* link. `decideRemovalMembership` only warns about ids Isometric
 * *returned* — this is the inverse: a removal we predicted but the registry
 * silently placed in a different (usually prior) reporting period.
 *
 * Pure; the caller supplies the expected set (from the same window logic the
 * preview used) and the reconciled `linkedRemovalIds`.
 */
export function expectedButExcludedWarnings(
  expected: readonly ExpectedRemoval[],
  linkedRemovalIds: readonly string[],
): string[] {
  const linked = new Set(linkedRemovalIds);
  return expected
    .filter((removal) => !linked.has(removal.localId))
    .map(
      (removal) =>
        `Removal ${removal.externalId} was expected in this period, but Isometric linked it to another period. Open the Removal and check its completion date.`,
    );
}
