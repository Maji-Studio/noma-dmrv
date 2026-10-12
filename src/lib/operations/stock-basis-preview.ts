import type { z } from "zod";
import { deadlineExceeded, DomainError } from "@/lib/domain-errors";
import type { OrgContext } from "@/lib/auth/server";
import type { Jsonified } from "./jsonified";
import { runOperation, type Operation, type OperationResult, type RunOptions } from "./runner";

export interface StockBasisPreviewOptions extends Omit<RunOptions, "deadlineMs" | "dryRun"> {
  /** The request's own deadline (epoch ms). The fallback never extends it. */
  deadlineAt: number;
  dryRun?: boolean;
}

function remainingMs(deadlineAt: number): number {
  return deadlineAt - Date.now();
}

/** The caller's input without the stale basis, as the fallback dry run sees it. */
function withoutBasis(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const rest: Record<string, unknown> = { ...input };
  delete rest.basisFingerprint;
  return rest;
}

/**
 * Run a stock write for an adapter. When it fails with `stock_basis_changed`,
 * answer the same error with `preview`: the current basis fingerprint and
 * stock effects, so the caller can show them and write again against them.
 *
 * The preview is one adapter-level fallback, started only after the failed
 * runner call has finished (its transaction rolled back, and with it any
 * idempotency claim and audit row). It is a dry run without the stale
 * fingerprint and without an idempotency key, so it never claims or replays a
 * key. It takes no second admission or rate-limit pass: the request was
 * charged once. It runs within the time left of the original deadline; if the
 * time is spent or the preview fails for any reason, the original error is
 * thrown unchanged, without `preview`.
 *
 * `basisOf` reads the basis fingerprint out of the operation's output.
 */
export async function runWithStockBasisPreview<Input extends z.ZodType, Output>(
  operation: Operation<Input, Output>,
  ctx: OrgContext,
  input: unknown,
  options: StockBasisPreviewOptions,
  basisOf: (data: Jsonified<Output>) => string | undefined,
): Promise<OperationResult<Output>> {
  const { deadlineAt, ...runOptions } = options;
  if (remainingMs(deadlineAt) <= 0) throw deadlineExceeded("before starting");
  try {
    return await runOperation(operation, ctx, input, { ...runOptions, deadlineMs: remainingMs(deadlineAt) });
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "stock_basis_changed") throw error;
    const deadlineMs = remainingMs(deadlineAt);
    if (deadlineMs <= 0) throw error;
    let preview: DomainError["preview"];
    try {
      const fresh = await runOperation(operation, ctx, withoutBasis(input), { pool: runOptions.pool, dryRun: true, deadlineMs });
      const basisFingerprint = basisOf(fresh.data);
      if (basisFingerprint && fresh.stockEffects) preview = { basisFingerprint, stockEffects: fresh.stockEffects };
    } catch {
      // The original conflict is still true and still actionable without a preview.
    }
    if (!preview) throw error;
    throw new DomainError("stock_basis_changed", error.message, { conflict: error.conflict, blockers: error.blockers, preview });
  }
}
