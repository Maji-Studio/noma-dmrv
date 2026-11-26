"use client";

/**
 * The facility's failed runs whose emissions have no credit batch yet (#1714):
 * one Notice above the credit batches, so it shows in the timeline, the list
 * and the empty state alike. It clears when a matching batch exists.
 */
import { MissingRunLinks } from "./credit-batch-missing-runs-notice";
import { Notice } from "@/components/ui/notice";
import { describeFailedRunEmissionTodo, failedRunEmissionTodoTitle } from "@/lib/production-runs/failed-run-emission-copy";
import { useFacilityFailedRunEmissionTodos } from "@/hooks/use-facility-failed-run-emission-todos";
import type { FailedRunEmissionGuidance } from "@/types/failed-run-emission-guidance";

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
  if (todos.isError || !todos.data) return null;
  return <FailedRunEmissionTodosView items={todos.data.map((todo) => todo.emissionAttachment)} facilityId={facilityId} />;
}
