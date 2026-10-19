/**
 * The one state a credit batch shows on /credit-batches, in the Timeline and
 * the List alike: Open, Ready, Submitted or Issued, plus the open to-dos while
 * it is Open. Open to-dos are Blocking + Check items, the batch page's Overview
 * badge; Waiting items never count.
 */
import type { CreditBatchHealthSummary } from "@/fn/certification";
import { deriveCreditBatchLifecycle } from "@/lib/certification/credit-batch-lifecycle";
import { deriveTimelineState, type TimelineState } from "./timeline";

export interface CreditBatchStateView {
  /** Null while the batch's readiness has not loaded (or could not be loaded). */
  state: TimelineState | null;
  /** Blocking items; zero unless the state is Open. */
  blockingCount: number;
  /** Blocking + Check items while Open; zero otherwise, like the page's first progress step. */
  openTodoCount: number;
}

export function creditBatchStateOf(
  summary: CreditBatchHealthSummary | undefined,
): CreditBatchStateView {
  if (!summary) return { state: null, blockingCount: 0, openTodoCount: 0 };
  const lifecycle = deriveCreditBatchLifecycle(summary);
  const state = deriveTimelineState({
    lifecycleStepIndex: lifecycle.currentStepIndex,
    lifecycleFailed: lifecycle.stepStates[lifecycle.currentStepIndex] === "failed",
    healthState: summary.state,
    blockingCount: summary.issueCount,
  });
  // Only an Open batch shows a count: Ready, Submitted and Issued batches show none.
  const isOpen = state === "blocking";
  return {
    state,
    blockingCount: isOpen ? summary.issueCount : 0,
    openTodoCount: isOpen ? summary.issueCount + summary.checkCount : 0,
  };
}
