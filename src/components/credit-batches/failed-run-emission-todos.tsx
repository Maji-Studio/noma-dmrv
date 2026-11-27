"use client";

/**
 * The facility's failed runs whose emissions have no credit batch yet (#1714):
 * one Notice above the credit batches, so it shows in the timeline, the list
 * and the empty state alike. It clears when a matching batch exists.
 */
import { MissingRunLinks } from "./credit-batch-missing-runs-notice";
import { Button } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import { CENTRED_HIT_AREA } from "@/components/ui/touch-target";
import { describeFailedRunEmissionTodo, failedRunEmissionTodoTitle } from "@/lib/production-runs/failed-run-emission-copy";
import { TRY_AGAIN_LABEL } from "@/lib/copy-utils";
import { useFacilityFailedRunEmissionTodos } from "@/hooks/use-facility-failed-run-emission-todos";
import type { FailedRunEmissionGuidance } from "@/types/failed-run-emission-guidance";

export const FAILED_RUN_TODOS_ERROR_MESSAGE = "Couldn't check which failed runs have emissions without a credit batch.";

export function FailedRunEmissionTodosView({ items, facilityId }: { items: readonly FailedRunEmissionGuidance[]; facilityId: string }) {
  if (items.length === 0) return null;
  return (
    <Notice tone="warning" data-testid="failed-run-emission-todos" title={failedRunEmissionTodoTitle(items.length)}>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.productionRunId}>
            <MissingRunLinks runs={[{ id: item.productionRunId, code: item.runCode }]} facilityId={facilityId} />
            {`: ${describeFailedRunEmissionTodo(item)}`}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

export function FailedRunEmissionTodos({ facilityId }: { facilityId: string }) {
  const todos = useFacilityFailedRunEmissionTodos(facilityId);
  // A failed read is not "nothing to do": say so, like the list's own Notices, and offer Try again.
  if (todos.isError) {
    return (
      <Notice
        tone="warning"
        data-testid="failed-run-emission-todos-error"
        action={<Button variant="weak" size="small" className={CENTRED_HIT_AREA} busy={todos.isFetching} onClick={() => void todos.refetch()}>{TRY_AGAIN_LABEL}</Button>}
      >
        {FAILED_RUN_TODOS_ERROR_MESSAGE}
      </Notice>
    );
  }
  if (!todos.data) return null;
  return <FailedRunEmissionTodosView items={todos.data.map((todo) => todo.emissionAttachment)} facilityId={facilityId} />;
}
