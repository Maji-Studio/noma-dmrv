/**
 * Generation of every Source-mirrored evidence ledger for a removal
 * (transport + tier-specific durability), run at submit time before the
 * candidate-document walk so the current ledgers ride into `source_ids` and
 * supersede any prior ones.
 *
 * Each ledger is regenerated from the live submission context and mirrored as a
 * Source. The flow owns a per-removal artifact lock for its list/create/retire
 * sequence and is idempotent on ledger content (an unchanged resubmit is a
 * no-op). Generation and retirement both fail closed: submission must not
 * proceed with a missing or stale generated Source. Each ledger skips itself
 * cleanly when it has nothing to evidence.
 */
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type { Logger } from "@/lib/log";
import type { RemovalSubmissionContext } from "./certify-context-core";
import { ensureDurabilityEvidenceLedgerSourceFromContext } from "./durability-evidence-ledger";
import { ensureTransportEvidenceLedgerSourceFromContext } from "./evidence-ledger";

const LEDGERS = [
  { name: "transport", run: ensureTransportEvidenceLedgerSourceFromContext },
  { name: "durability", run: ensureDurabilityEvidenceLedgerSourceFromContext },
] as const;

export async function ensureEvidenceLedgersFromContext(
  orgCtx: OrgContext,
  removalId: string,
  ctx: RemovalSubmissionContext,
  log: Logger,
): Promise<void> {
  for (const ledger of LEDGERS) {
    try {
      const result = await ledger.run(orgCtx, removalId, ctx);
      log.info(
        { ledger: ledger.name, ledgerStatus: result.status },
        "evidence ledger ensured",
      );
    } catch (err) {
      log.warn(
        {
          ledger: ledger.name,
          errorName: err instanceof Error ? err.name : typeof err,
        },
        "evidence ledger generation failed; submission blocked",
      );
      if (err instanceof SafeError) throw err;
      throw new SafeError(
        `Unable to prepare the ${ledger.name} evidence ledger. Retry the Removal submission.`,
      );
    }
  }
}
