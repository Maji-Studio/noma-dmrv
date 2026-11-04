/**
 * The one state a credit batch shows on /credit-batches, in the Timeline and
 * the List alike: Open, Ready, Submission interrupted, Submitted or Issued,
 * plus the open to-dos while it is Open or interrupted. Open to-dos are
 * Blocking + Check items, the batch page's Overview badge; Waiting items never count.
 */
import type { CreditBatchHealthSummary } from "@/fn/certification";
import { deriveCreditBatchLifecycle } from "@/lib/certification/credit-batch-lifecycle";
import { deriveTimelineState, type TimelineState } from "./timeline";

export interface CreditBatchStateView {
  /** Null while the batch's readiness has not loaded (or could not be loaded). */
  state: TimelineState | null;
  /** Blocking items; zero unless the state is Open or interrupted. */
  blockingCount: number;
  /** Blocking + Check items while Open or interrupted, matching the batch page. */
  openTodoCount: number;
}

export function creditBatchStateOf(
  summary: CreditBatchHealthSummary | undefined,
): CreditBatchStateView {
  if (!summary) return { state: null, blockingCount: 0, openTodoCount: 0 };
  const lifecycle = deriveCreditBatchLifecycle(summary);
  const state = deriveTimelineState({
    removalInterrupted: summary.removalInterrupted,
    lifecycleStepIndex: lifecycle.currentStepIndex,
    lifecycleFailed: lifecycle.stepStates[lifecycle.currentStepIndex] === "failed",
    healthState: summary.state,
    blockingCount: summary.issueCount,
  });
  // An interrupted submission still needs its open items, as on the batch page.
  const showTodos = state === "blocking" || state === "interrupted";
  return {
    state,
    blockingCount: showTodos ? summary.issueCount : 0,
    openTodoCount: showTodos ? summary.issueCount + summary.checkCount : 0,
  };
}
