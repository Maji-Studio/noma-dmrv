/**
 * Pure GHG-statement ↔ Removal membership reconciliation.
 *
 * Isometric decides which Removals a GHG Statement absorbs server-side (by
 * reporting-period date range) and returns them as `GhgStatement.removal_ids`.
 * This decides how that remote membership maps onto local `certifier_removals`
 * rows: which to stamp, which are already linked, and where the two sides
 * have drifted. It never steals a removal already owned by another statement.
 *
 * No I/O. The data-access layer supplies the ledger + current-membership
 * lookups and applies the resulting `toLink` writes inside a transaction.
 */

export interface RemovalMembershipInput {
  /** Isometric removal ids the statement absorbed (`GhgStatement.removal_ids`). */
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

  // Each Isometric removal id with no local ledger row → drift.
  for (const externalId of externalRemovalIds) {
    if (!externalToLocal.has(externalId)) {
      warnings.push(
        `Isometric linked removal ${externalId}, which has no local record.`,
      );
    }
  }

  const localRemovalIds = [...new Set(externalToLocal.values())];
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
        `Removal ${removalId} is already linked to a different GHG statement; left unchanged.`,
      );
    }
  }

  return { toLink, linkedRemovalIds, warnings };
}
