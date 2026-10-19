/**
 * The one state a credit batch shows on /credit-batches, in the Timeline and
 * the List alike: Open, Ready, Submitted or Issued, plus the count of blocking
 * items while it is Open.
 */
import type { CreditBatchHealthSummary } from "@/fn/certification";
import { deriveCreditBatchLifecycle } from "@/lib/certification/credit-batch-lifecycle";
import { deriveTimelineState, type TimelineState } from "./timeline";

export interface CreditBatchStateView {
  /** Null while the batch's readiness has not loaded (or could not be loaded). */
  state: TimelineState | null;
  /** Blocking items; zero unless the state is Open. */
  blockingCount: number;
}

export function creditBatchStateOf(
  summary: CreditBatchHealthSummary | undefined,
): CreditBatchStateView {
  if (!summary) return { state: null, blockingCount: 0 };
  const lifecycle = deriveCreditBatchLifecycle(summary);
  const state = deriveTimelineState({
    lifecycleStepIndex: lifecycle.currentStepIndex,
    lifecycleFailed: lifecycle.stepStates[lifecycle.currentStepIndex] === "failed",
    healthState: summary.state,
    blockingCount: summary.issueCount,
  });
  // Waiting items never count; a submitted or issued batch shows no count.
  return { state, blockingCount: state === "blocking" ? summary.issueCount : 0 };
}
