/**
 * The Emissions tab of a credit batch (epic #1058, design C3c "Source chips"):
 * KPI strip, state chips and sort, then the lines grouped by template group. A
 * row expands as an accordion (From records + Manual entries = Total, then the
 * line comment). The batch page owns the title, dates and breadcrumb; the
 * previous / next pager shows only when the tab was opened from the Emissions list.
 */
"use client";

import { useState } from "react";
import { Button, Notice } from "@/components/ui";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import {
  useBatchEmissionLines,
  useDeleteEmissionEntry,
  useRestoreEmissionEntry,
  type EmissionBatchScope,
} from "@/hooks/use-emission-entries";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { formatFacilityDate } from "@/lib/date-utils";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { useBatchLineQuery, useOpenedFromEmissionsList } from "./batch-emissions-query";
import { BatchEmissionsPager } from "./batch-emissions-pager";
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
import { TemplateSetupNotice } from "./template-setup-notice";
import { isEmissionLinesBlocked } from "@/lib/certification/emission-lines-blocked-error";
import { MONTH_PREFIX_LENGTH } from "./emissions-overview-query";

const LIST_SKELETON = "h-320 w-full";

/** `version` is the deleted entry's version, which the restore expects. */
type UndoState = { id: number; line: EmissionLine; entry: EmissionEntry; version: number };
type EntryTarget = { line: EmissionLine; entry: EmissionEntry };

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

interface BatchEmissionsProps {
  facilityId: string;
  batch: EmissionBatch;
  /** The credit batch page is read only: entries and comments show, nothing can be added, edited or deleted. */
  readOnly?: boolean;
}

export function BatchEmissions({ facilityId, batch, readOnly = false }: BatchEmissionsProps) {
  const scope: EmissionBatchScope = { facilityId, creditBatchId: batch.creditBatchId };
  const toast = useToast();
  const { timeZone } = useFacilityClock(scope.facilityId);
  const today = formatFacilityDate(new Date(), timeZone);
  const fromEmissionsList = useOpenedFromEmissionsList();
  const linesQuery = useBatchEmissionLines(scope);
  const { filter, sort, setFilter, setSort } = useBatchLineQuery();
  const [form, setForm] = useState<{ componentId: string; mode: EntryFormMode } | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [stoppedDelete, setStoppedDelete] = useState<EntryTarget | null>(null);
  const [stoppedDeleteError, setStoppedDeleteError] = useState<string | null>(null);
  const deleteEntry = useDeleteEmissionEntry(scope);
  const restoreEntry = useRestoreEmissionEntry(scope);
  const lines = linesQuery.data ?? [];
  const formLine = form ? (lines.find((line) => line.componentId === form.componentId) ?? null) : null;
  const visible = sortLines(lines.filter((line) => lineMatches(line, filter)), sort);
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
  return (
    <div className="flex min-w-0 flex-col gap-24">
      {fromEmissionsList && (
        <BatchEmissionsPager creditBatchId={scope.creditBatchId} facilityId={scope.facilityId} lineFilter={filter} lineSort={sort} />
      )}
      {isEmissionLinesBlocked(linesQuery.error) ? (
        <TemplateSetupNotice blocker={linesQuery.error.blocker} facilityId={scope.facilityId} creditBatchId={scope.creditBatchId} />
      ) : linesQuery.error && !linesQuery.data ? (
        <Notice tone="error" action={<Button size="small" variant="default" onClick={() => void linesQuery.refetch()}>Try again</Button>}>
          {linesQuery.error.message || "The components could not be loaded."}
        </Notice>
      ) : linesQuery.isLoading ? (
        <Skeleton className={LIST_SKELETON} />
      ) : (
        <>
          <BatchKpiStrip kpis={batchKpis(lines, timeZone, today)} filter={filter} onFilter={setFilter} />
          <div className="flex flex-col gap-12">
            <LineToolbar counts={counts} filter={filter} sort={sort} onFilter={setFilter} onSort={setSort} />
            <EmissionLineList
              lines={visible}
              grouped={sort === "template"}
              scope={scope}
              expanded={expanded}
              editingCommentId={editingCommentId}
              undo={undo && undoInline ? { componentId: undo.line.componentId, bar: undoBar } : null}
              filterLabel={lineChipLabel(filter)}
              onClearFilter={() => setFilter(null)}
              actions={{
                readOnly,
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
