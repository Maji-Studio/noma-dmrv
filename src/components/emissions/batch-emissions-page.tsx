/**
 * The Emissions page of one credit batch (epic #1058, design C3c "Source
 * chips"): breadcrumb and pager, KPI strip, state chips and sort, then the
 * lines grouped by template group. A row expands as an accordion (From records
 * + Manual entries = Total, then the line comment); "Record this month" turns the list into a grid
 * of every open line with one Save all.
 */
"use client";

import { useState } from "react";
import { FileDashedIcon } from "@phosphor-icons/react/dist/ssr";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { Button, EmptyState, Notice, PageHeader } from "@/components/ui";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import {
  useBatchEmissionLines,
  useDeleteEmissionEntry,
  useRestoreEmissionEntry,
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
import { EmissionEntryFormPanel } from "./emission-entry-form-panel";
import type { EntryFormMode } from "./manual-entry-form";
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
import { MONTH_PREFIX_LENGTH, useEmissionsOverviewQuery } from "./emissions-overview-query";
import { RecordMonthGrid } from "./record-month-grid";
import { takesGridInput } from "./record-month-row";

const SUBTITLE = "Manual entries add on top of what records already hold.";
const LIST_SKELETON = "h-320 w-full";

/** `version` is the deleted entry's version, which the restore expects. */
type UndoState = { id: number; line: EmissionLine; entry: EmissionEntry; version: number };
type EntryTarget = { line: EmissionLine; entry: EmissionEntry };

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
  const month = today.slice(0, MONTH_PREFIX_LENGTH);
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
  const [form, setForm] = useState<{ componentId: string; mode: EntryFormMode } | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [stoppedDelete, setStoppedDelete] = useState<EntryTarget | null>(null);
  const [stoppedDeleteError, setStoppedDeleteError] = useState<string | null>(null);
  const deleteEntry = useDeleteEmissionEntry(scope);
  const restoreEntry = useRestoreEmissionEntry(scope);

  const overviewBatch = overview.data?.batches.find((batch) => batch.creditBatchId === scope.creditBatchId) ?? null;
  const lines = linesQuery.data ?? [];
  const formLine = form ? (lines.find((line) => line.componentId === form.componentId) ?? null) : null;
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
  const setExpandedLine = (line: EmissionLine, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(line.componentId);
      else next.delete(line.componentId);
      return next;
    });
  const toggleLine = (line: EmissionLine) => {
    const open = !expanded.has(line.componentId);
    setExpandedLine(line, open);
    if (!open && editingCommentId === line.componentId) setEditingCommentId(null);
  };

  const deleteFailed = (line: EmissionLine, error: unknown) =>
    toSaveErrorMessage(error, `The manual entry on ${line.displayName} was not deleted. Try again.`);

  const removeEntry = async (line: EmissionLine, entry: EmissionEntry) => {
    // A stopped entry cannot be restored against the current template, so it gets no Undo: confirm first.
    if (!entry.counts) {
      setStoppedDeleteError(null);
      setStoppedDelete({ line, entry });
      return;
    }
    try {
      const deleted = await deleteEntry.mutateAsync({ id: entry.id, expectedVersion: entry.version });
      // Undo shows under the row; its button takes focus because the entry's menu is gone.
      setUndo({ id: Date.now(), line, entry, version: deleted.version });
    } catch (error) {
      toast.error(deleteFailed(line, error));
    }
  };

  const confirmStoppedDelete = async () => {
    if (!stoppedDelete) return;
    const { line, entry } = stoppedDelete;
    try {
      await deleteEntry.mutateAsync({ id: entry.id, expectedVersion: entry.version });
      setStoppedDelete(null);
      toast.success(`Manual entry deleted on ${line.displayName}.`);
    } catch (error) {
      setStoppedDeleteError(deleteFailed(line, error));
    }
  };

  const undoLast = async () => {
    if (!undo) return;
    setUndoing(true);
    try {
      await restoreEntry.mutateAsync({ id: undo.entry.id, expectedVersion: undo.version });
      setUndo(null);
    } catch (error) {
      toast.error(toSaveErrorMessage(error, "The change was not undone. Try again."));
    } finally {
      setUndoing(false);
    }
  };

  const undoMessage = undo ? `Manual entry deleted on ${undo.line.displayName}.${undo.entry.documentCount ? " Undo brings back the values and the files." : ""}` : "";

  // Under its row while the row is listed; floating when the delete moved the line out of the filter or off the template.
  const undoInline = !!undo && visible.some((line) => line.componentId === undo.line.componentId);
  const undoBar = undo ? (
    <EmissionsUndoBar key={undo.id} inline={undoInline} message={undoMessage} undoing={undoing} onUndo={() => void undoLast()} onDismiss={() => setUndo(null)} />
  ) : null;

  const counts = lineCounts(lines);
  const canRecord = entriesEnabled && !!batch && lines.some(takesGridInput);

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
            today={today}
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
                if (!entry) return;
                if (line.entryPolicy !== "none") return setForm({ componentId: line.componentId, mode: { kind: "again", entry } });
                setRecording(false);
                setExpandedLine(line, true);
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
                expanded={expanded}
                editingCommentId={editingCommentId}
                undo={undo && undoInline ? { componentId: undo.line.componentId, bar: undoBar } : null}
                filterLabel={lineChipLabel(filter)}
                onClearFilter={() => setFilter(null)}
                actions={{
                  toggle: toggleLine,
                  form: (line, mode) => setForm({ componentId: line.componentId, mode }),
                  comment: (line) => {
                    setExpandedLine(line, true);
                    setEditingCommentId(line.componentId);
                  },
                  editingComment: (line, editing) => setEditingCommentId(editing ? line.componentId : null),
                  deleteEntry: (line, entry) => void removeEntry(line, entry),
                }}
              />
              {undo && !undoInline && undoBar}
            </div>
          )}
          <DeleteConfirmDialog
            isOpen={!!stoppedDelete}
            title="Delete this manual entry?"
            message={stoppedDelete ? `The stopped manual entry on ${stoppedDelete.line.displayName} is deleted. It cannot be undone.` : ""}
            onConfirm={() => void confirmStoppedDelete()}
            onCancel={() => setStoppedDelete(null)}
            isPending={deleteEntry.isPending}
            errorMessage={stoppedDeleteError ?? undefined}
          />
          <EmissionEntryFormPanel
            line={formLine}
            mode={form?.mode ?? null}
            batch={batch}
            scope={scope}
            today={today}
            onClose={() => setForm(null)}
            onSaved={(line, warning) => (warning ? toast.warning(warning) : toast.success(`Manual entry saved on ${line.displayName}.`))}
          />
        </>
      )}
    </div>
  );
}
