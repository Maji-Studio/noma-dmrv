/**
 * The dashboard body for an onboarded facility: the KPI band, the stage band
 * (landscape scene, stage cells, record actions), then To do, Bins and Recent
 * activity. Everything but Bins reads the chosen credit batch (or all of
 * them); Bins stays facility-wide.
 */
"use client";

import type { DashboardOverview } from "@/data-access/dashboard-overview";
import type { OnboardingStatus } from "@/data-access/onboarding";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useCreditBatchHealthSummaries } from "@/hooks/use-certification";
import { useDashboardBatchScope } from "@/hooks/use-dashboard-batch-scope";
import { applyBatchScope } from "./batch-scope";
import { batchTodoRows } from "./batch-todo-rows";
import { BinsCard } from "./bins-card";
import { useFlowActions } from "./flow-actions";
import { HeroKpiBand } from "./hero-kpi-band";
import { useAllBatchesHref, useSelectedBatchId } from "./scope";
import { StageBand } from "./stage-band";
import {
  ActivityEmpty,
  DashRowList,
  DashSection,
  LoadError,
  PartialFiguresNotice,
  RowsSkeleton,
  TodoEmpty,
  activityRows,
  todoRows,
} from "./shared";

/** Recent activity rows: as many as the Bins card shows. */
const ACTIVITY_ROWS = 5;

interface DashboardBodyProps {
  data: DashboardOverview | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  facilityId: string;
  timeZone: string;
  /** Onboarding status: what the facility has, so actions match its state. */
  status: OnboardingStatus | undefined;
}

export function DashboardBody({ data: overview, isLoading: overviewLoading, error, onRetry, facilityId, timeZone, status }: DashboardBodyProps) {
  const batchId = useSelectedBatchId(facilityId);
  // Wait for the batch list before reading, so a stale `?batch=` reads all batches once.
  const scope = useDashboardBatchScope(batchId === undefined ? null : facilityId, batchId ?? null);
  const data = overview && scope.data ? applyBatchScope(overview, scope.data) : undefined;
  const isLoading = overviewLoading || (data == null && scope.error == null);
  // What the facility can record now does not depend on the batch filter.
  const actions = useFlowActions(status, facilityId, overview);
  const allBatchesHref = useAllBatchesHref();
  // Each active batch's open to-dos: the same read the Credit batches list uses.
  const { data: batches, isPending: batchesPending } = useCreditBatches(facilityId);
  const healthIds = (batches ?? []).filter((batch) => batchId == null || batch.id === batchId).map((batch) => batch.id);
  const health = useCreditBatchHealthSummaries(facilityId, healthIds);

  if ((error && !overview) || (scope.error && !scope.data)) {
    return (
      <LoadError
        message={(scope.error ?? error)?.message ?? null}
        clearFilterHref={batchId ? allBatchesHref : null}
        onRetry={() => {
          onRetry();
          void scope.refetch();
        }}
      />
    );
  }

  // A failed read adds no batch rows; the other rows stay.
  const todos = data
    ? [
        ...todoRows(data.attention, data.structuralGaps),
        ...batchTodoRows(batches ?? [], health.data, batchId ?? null),
      ]
    : [];
  const activity = data ? activityRows(data.activity, timeZone) : [];
  const todosLoading = batchesPending || (healthIds.length > 0 && health.isLoading);
  const pending = isLoading || !data;

  return (
    <>
      <HeroKpiBand kpis={data?.kpis} isLoading={isLoading} />

      {scope.data && !scope.data.downstreamComplete && <PartialFiguresNotice />}

      <DashSection label="Traceability stages" headingId="dashboard-stages">
        {pending ? (
          <div className="p-20" aria-hidden>
            <Skeleton height={240} width="100%" />
          </div>
        ) : (
          <StageBand data={data} actions={actions} />
        )}
      </DashSection>

      {/* Stretched, so the three cards end level. */}
      <div className="grid grid-cols-1 items-stretch gap-24 lg:grid-cols-3">
        <DashSection title="To do" headingId="dashboard-todo">
          {pending || todosLoading ? (
            <RowsSkeleton />
          ) : todos.length === 0 ? (
            <TodoEmpty clearFilterHref={batchId ? allBatchesHref : null} />
          ) : (
            <DashRowList rows={todos} label="To do" />
          )}
        </DashSection>

        <BinsCard facilityId={facilityId} />

        <DashSection title="Recent activity" headingId="dashboard-activity">
          {pending ? (
            <RowsSkeleton />
          ) : activity.length === 0 ? (
            <ActivityEmpty clearFilterHref={batchId ? allBatchesHref : null} />
          ) : (
            <DashRowList rows={activity.slice(0, ACTIVITY_ROWS)} label="Recent activity" />
          )}
        </DashSection>
      </div>
    </>
  );
}
