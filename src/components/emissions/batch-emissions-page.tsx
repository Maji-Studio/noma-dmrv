/**
 * The Emissions page of one credit batch (epic #1058, design C3c "Source
 * chips"): breadcrumb and pager, KPI strip, state chips and sort, then the
 * lines grouped by template group. A row opens the ledger drawer (From records
 * + Manual entries = Total); "Record this month" turns the list into a grid
 * of every open line with one Save all.
 */
"use client";

import { useState } from "react";
import { FileDashedIcon } from "@phosphor-icons/react/dist/ssr";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { Button, EmptyState, Notice, PageHeader } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import {
  useBatchEmissionLines,
  useDeleteEmissionEntry,
  useRestoreEmissionEntry,
  useMarkNothingToRecord,
  type EmissionBatchScope,
} from "@/hooks/use-emission-entries";
import { useEmissionsOverview, type FacilityEmissionsOverviewBatch } from "@/hooks/use-emissions-overview";
import { useFacilityClock, useFacilityContext } from "@/hooks/use-facility-context";
import { formatFacilityDate } from "@/lib/date-utils";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { useBatchLineQuery } from "./batch-emissions-query";
import { BatchEmissionsTopBar } from "./batch-emissions-pager";
import { BatchKpiStrip, LineToolbar, lineChipLabel, type BatchKpis } from "./batch-emissions-toolbar";
import { EmissionLineDrawer, type DrawerView } from "./emission-line-drawer";
import { EmissionLineList } from "./emission-line-list";
import {
  isOpen,
  lineCounts,
  lineMatches,
  sortLines,
  valueEntries,
  type EmissionBatch,
  type EmissionEntry,
  type EmissionLine,
} from "./emission-line-display";
import { EmissionsUndoBar } from "./emissions-undo-bar";
import { useEmissionsOverviewQuery } from "./emissions-overview-query";
import { RecordMonthGrid } from "./record-month-grid";

const SUBTITLE = "Manual entries add on top of what records already hold.";
const LIST_SKELETON = "h-320 w-full";
const MONTH_LENGTH = 7;

type UndoState =
  | { id: number; kind: "nothing"; componentId: string; lineName: string; entry: { id: string; version: number } }
  | { id: number; kind: "delete"; line: EmissionLine; entry: EmissionEntry };

interface BatchEmissionsPageProps {
  creditBatchId: string;
  /** Manual entry writes are behind EMISSIONS_ENTRIES_ENABLED. */
  entriesEnabled: boolean;
}

export function BatchEmissionsPage({ creditBatchId, entriesEnabled }: BatchEmissionsPageProps) {
  const { facilityId } = useFacilityContext();
  if (!facilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader area="infrastructure" title="Emissions" subtitle={SUBTITLE} />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to see this credit batch's emissions." />
      </div>
    );
  }
  return <BatchEmissions key={`${facilityId}-${creditBatchId}`} scope={{ facilityId, creditBatchId }} entriesEnabled={entriesEnabled} />;
}

function batchFacts(batch: FacilityEmissionsOverviewBatch): EmissionBatch {
  return { creditBatchId: batch.creditBatchId, code: batch.code, startDate: batch.startDate, endDate: batch.endDate };
}

function batchSubtitle(batch: FacilityEmissionsOverviewBatch): string {
  const period = batch.endDate ? formatDateRange(batch.startDate, batch.endDate) : `From ${formatDate(batch.startDate)}`;
  return batch.templateName ? `${period}. ${batch.templateName}.` : `${period}.`;
}

function batchKpis(lines: EmissionLine[], timeZone: string, today: string): BatchKpis {
  const entries = lines.flatMap(valueEntries);
  const month = today.slice(0, MONTH_LENGTH);
  return {
    open: lines.filter(isOpen).length,
    total: lines.length,
    filesMissing: lines.filter((line) => line.state === "missingEvidence").length,
    entriesThisMonth: entries.filter((entry) => formatFacilityDate(new Date(entry.createdAt), timeZone).startsWith(month)).length,
    lastEntryAt: entries.reduce<Date | null>((latest, entry) => {
      const at = new Date(entry.createdAt);
      return !latest || at > latest ? at : latest;
    }, null),
  };
}

function BatchEmissions({ scope, entriesEnabled }: { scope: EmissionBatchScope; entriesEnabled: boolean }) {
  const toast = useToast();
  const { timeZone } = useFacilityClock(scope.facilityId);
  const today = formatFacilityDate(new Date(), timeZone);
  const overview = useEmissionsOverview(scope.facilityId);
  const { query: overviewQuery } = useEmissionsOverviewQuery();
  const linesQuery = useBatchEmissionLines(scope);
  const { filter, sort, setFilter, setSort } = useBatchLineQuery();
  const [recording, setRecording] = useState(false);
  const [drawer, setDrawer] = useState<{ componentId: string; view: DrawerView } | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [undoing, setUndoing] = useState(false);
  const markNothing = useMarkNothingToRecord(scope);
  const deleteEntry = useDeleteEmissionEntry(scope);
  const restoreEntry = useRestoreEmissionEntry(scope);

  const overviewBatch = overview.data?.batches.find((batch) => batch.creditBatchId === scope.creditBatchId) ?? null;
  const lines = linesQuery.data ?? [];
  const drawerLine = drawer ? (lines.find((line) => line.componentId === drawer.componentId) ?? null) : null;
  const visible = sortLines(lines.filter((line) => lineMatches(line, filter)), sort);

  if (overview.isSuccess && !overviewBatch) {
    return (
      <div className="container-max page-shell">
        <PageHeader area="infrastructure" title="Emissions" subtitle={SUBTITLE} />
        <EmptyState
          icon={<FileDashedIcon size={48} />}
          title="Credit batch not found"
          description="This credit batch is not at the selected facility. Choose another facility or go back to Emissions."
        />
      </div>
    );
  }

  const batch: EmissionBatch | null = overviewBatch ? batchFacts(overviewBatch) : null;
  const openDrawer = (line: EmissionLine, view: DrawerView = { kind: "ledger" }) => setDrawer({ componentId: line.componentId, view });

  const markLine = async (line: EmissionLine) => {
    try {
      const entry = await markNothing.mutateAsync({ ...scope, componentId: line.componentId });
      setUndo({ id: Date.now(), kind: "nothing", componentId: line.componentId, lineName: line.displayName, entry: { id: entry.id, version: entry.version } });
    } catch (error) {
      toast.error(toSaveErrorMessage(error, `${line.displayName} was not marked Nothing to record. Try again.`));
    }
  };

  const removeEntry = async (line: EmissionLine, entry: EmissionEntry) => {
    try {
      await deleteEntry.mutateAsync({ id: entry.id, expectedVersion: entry.version });
      // Undo lives in the page bar, outside the drawer's focus trap, so the drawer closes.
      setDrawer(null);
      setUndo({ id: Date.now(), kind: "delete", line, entry });
    } catch (error) {
      toast.error(toSaveErrorMessage(error, `The manual entry on ${line.displayName} was not deleted. Try again.`));
    }
  };

  const undoLast = async () => {
    if (!undo) return;
    setUndoing(true);
    try {
      if (undo.kind === "nothing") {
        await deleteEntry.mutateAsync({ id: undo.entry.id, expectedVersion: undo.entry.version });
      } else if (undo.entry.kind === "zero") {
        await markNothing.mutateAsync({ ...scope, componentId: undo.line.componentId, note: undo.entry.note, occurredOn: undo.entry.occurredOn });
      } else {
        // Delete bumped the version once, so the restore expects the next one.
        await restoreEntry.mutateAsync({ id: undo.entry.id, expectedVersion: undo.entry.version + 1 });
      }
      setUndo(null);
    } catch (error) {
      toast.error(toSaveErrorMessage(error, "The change was not undone. Try again."));
    } finally {
      setUndoing(false);
    }
  };

  const undoMessage = !undo
    ? ""
    : undo.kind === "nothing"
      ? `${undo.lineName} marked Nothing to record.`
      : undo.entry.kind === "zero"
        ? `Nothing to record removed from ${undo.line.displayName}.`
        : `Manual entry deleted on ${undo.line.displayName}.${undo.entry.documentCount ? " Undo brings back the values and the files." : ""}`;
  const undoLine = undo?.kind === "nothing" ? lines.find((line) => line.componentId === undo.componentId) : undefined;

  const counts = lineCounts(lines);
  const openCount = lines.filter(isOpen).length;
  const canRecord = entriesEnabled && !!batch && openCount > 0;

  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-4">
        {overviewBatch ? (
          <BatchEmissionsTopBar
            code={overviewBatch.code}
            creditBatchId={scope.creditBatchId}
            facilityId={scope.facilityId}
            batches={overview.data?.batches ?? []}
            query={overviewQuery}
            lineFilter={filter}
            lineSort={sort}
          />
        ) : (
          <Skeleton className="h-44 w-[240px]" />
        )}
        <PageHeader
          title={overviewBatch?.code ?? "Emissions"}
          subtitle={overviewBatch ? batchSubtitle(overviewBatch) : SUBTITLE}
          actions={
            recording || !entriesEnabled ? null : (
              <Button
                variant="primary"
                disabled={!canRecord}
                onClick={() => {
                  setUndo(null);
                  setRecording(true);
                }}
              >
                Record this month
              </Button>
            )
          }
        />
      </div>
      {!entriesEnabled && <Notice tone="info">Manual entries are not switched on yet. Lines show what records hold.</Notice>}
      {linesQuery.error && !linesQuery.data ? (
        <Notice tone="error" action={<Button size="small" variant="default" onClick={() => void linesQuery.refetch()}>Try again</Button>}>
          {linesQuery.error.message || "The emission lines could not be loaded."}
        </Notice>
      ) : overview.error && !overview.data ? (
        <Notice tone="error" action={<Button size="small" variant="default" onClick={() => void overview.refetch()}>Try again</Button>}>
          {overview.error.message || "The credit batch could not be loaded."}
        </Notice>
      ) : linesQuery.isLoading || !batch ? (
        <Skeleton className={LIST_SKELETON} />
      ) : (
        <>
          <BatchKpiStrip kpis={batchKpis(lines, timeZone, today)} filter={filter} onFilter={setFilter} />
          {recording ? (
            <RecordMonthGrid
              lines={lines}
              batch={batch}
              scope={scope}
              today={today}
              onDone={() => setRecording(false)}
              onEnterAgain={(line) => {
                const entry = line.entries.find((candidate) => !candidate.counts);
                // A line removed from the template takes no new entry; its ledger offers Delete.
                if (entry) openDrawer(line, line.entryPolicy === "none" ? { kind: "ledger" } : { kind: "form", mode: { kind: "again", entry } });
              }}
            />
          ) : (
            <div className="flex flex-col gap-12">
              <LineToolbar counts={counts} filter={filter} sort={sort} onFilter={setFilter} onSort={setSort} />
              <EmissionLineList
                lines={visible}
                grouped={sort === "template"}
                scope={scope}
                canWrite={entriesEnabled}
                filterLabel={lineChipLabel(filter)}
                onClearFilter={() => setFilter(null)}
                actions={{
                  open: (line, options) => openDrawer(line, options?.add ? { kind: "form", mode: { kind: "add" } } : { kind: "ledger" }),
                  nothing: (line) => void markLine(line),
                }}
              />
            </div>
          )}
          <EmissionLineDrawer
            line={drawerLine}
            view={drawer?.view ?? { kind: "ledger" }}
            batch={batch}
            scope={scope}
            today={today}
            canWrite={entriesEnabled}
            onViewChange={(view) => setDrawer((current) => (current ? { ...current, view } : current))}
            onClose={() => setDrawer(null)}
            onNothing={(line) => void markLine(line)}
            onDeleteEntry={(line, entry) => void removeEntry(line, entry)}
            onSaved={(line, warning) => (warning ? toast.warning(warning) : toast.success(`Manual entry saved on ${line.displayName}.`))}
          />
        </>
      )}
      {undo && !recording && (
        <EmissionsUndoBar
          key={undo.id}
          message={undoMessage}
          undoing={undoing}
          onUndo={() => void undoLast()}
          onAddNote={undoLine ? () => { openDrawer(undoLine, { kind: "ledger", focusNote: true }); setUndo(null); } : undefined}
          onDismiss={() => setUndo(null)}
        />
      )}
    </div>
  );
}
