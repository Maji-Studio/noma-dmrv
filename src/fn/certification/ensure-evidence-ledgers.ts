/**
 * Best-effort generation of every Source-mirrored evidence ledger for a removal
 * (transport + 200-year durability), run at submit time before the candidate-
 * document walk so the current ledgers ride into `source_ids` and supersede any
 * prior ones.
 *
 * Each ledger is regenerated from the live submission context and mirrored as a
 * Source. The flow owns a per-removal artifact lock for its list/create/retire
 * sequence and is idempotent on ledger content (an unchanged resubmit is a
 * no-op). Best-effort by contract: a render/mirror hiccup for one ledger is
 * logged and skipped — it must never block an otherwise-valid submission, and
 * the next submit regenerates it. Each ledger skips itself cleanly when it has
 * nothing to evidence (no legs / no sampled batches / no soil reference).
 */
import type { Logger } from "@/lib/log";
import type { RemovalSubmissionContext } from "./certify-context-core";
import { ensureDurabilityEvidenceLedgerSourceFromContext } from "./durability-evidence-ledger";
import { ensureTransportEvidenceLedgerSourceFromContext } from "./evidence-ledger";

const LEDGERS = [
  { name: "transport", run: ensureTransportEvidenceLedgerSourceFromContext },
  { name: "durability", run: ensureDurabilityEvidenceLedgerSourceFromContext },
] as const;

export async function ensureEvidenceLedgersFromContext(
  userId: string,
  removalId: string,
  ctx: RemovalSubmissionContext,
  log: Logger,
): Promise<void> {
  for (const ledger of LEDGERS) {
    try {
      const result = await ledger.run(userId, removalId, ctx);
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
        "evidence ledger generation failed; submitting without it",
      );
    }
  }
}
