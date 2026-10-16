/**
 * "Record this month": every open line of the credit batch at once. Records
 * stay as they are; what the operator types adds on top. Save all validates
 * inline, then saves line by line, so one refused line keeps its error and its
 * draft while the others save.
 */
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Notice } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useFileUpload } from "@/hooks/use-file-upload";
import {
  invalidateEmissionEntryReads,
  useConfirmEmissionEntry,
  useCreateEmissionEntry,
  useMarkNothingToRecord,
  type EmissionBatchScope,
} from "@/hooks/use-emission-entries";
import { pluralize } from "@/lib/copy-utils";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { cn } from "@/lib/utils";
import { EmissionLineBadge } from "./emission-line-badge";
import { ENTRY_ENTITY_TYPE } from "./emission-entry-files";
import {
  defaultEntryDate,
  entryDocumentType,
  entryValues,
  isOpen,
  isRecordsGap,
  lineRecords,
  lineTotalText,
  stoppedEntries,
  validateEntryDate,
  validateFields,
  type EmissionBatch,
  type EmissionLine,
} from "./emission-line-display";
import { SourceChips } from "./emission-source-chips";
import { RecordMonthRow, entryMissingFile, rowKind, type RowDraft } from "./record-month-row";

const SAVE_FALLBACK = "This line was not saved. Check its values and try again.";
const FILE_FALLBACK = "The file did not upload. Try again.";

interface RecordMonthGridProps {
  lines: EmissionLine[];
  batch: EmissionBatch;
  scope: EmissionBatchScope;
  today: string;
  onDone: () => void;
  onEnterAgain: (line: EmissionLine) => void;
}

interface RowStatus { line: EmissionLine; draft: RowDraft; errors: Record<string, string> }

export function RecordMonthGrid({ lines, batch, scope, today, onDone, onEnterAgain }: RecordMonthGridProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const createEntry = useCreateEmissionEntry(scope);
  const markNothing = useMarkNothingToRecord(scope);
  const confirmEntry = useConfirmEmissionEntry(scope);
  const { upload } = useFileUpload();
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const blank = (): RowDraft => ({ values: {}, date: defaultEntryDate(today, batch), note: "", nothing: false, file: null });
  const draftOf = (line: EmissionLine) => drafts[line.componentId] ?? blank();
  const patch = (line: EmissionLine, change: Partial<RowDraft>) =>
    setDrafts((all) => ({ ...all, [line.componentId]: { ...(all[line.componentId] ?? blank()), ...change } }));

  const openLines = lines.filter(isOpen);
  const doneLines = lines.filter((line) => !isOpen(line));
  const gapLines = openLines.filter((line) => rowKind(line) === "value" && isRecordsGap(lineRecords(line)));

  const touched = (line: EmissionLine, draft: RowDraft) => {
    const kind = rowKind(line);
    if (kind === "fileOnly") return !!draft.file;
    if (kind !== "value") return false;
    return draft.nothing || !!draft.file || Object.values(draft.values).some((value) => value.trim());
  };
  const validate = (line: EmissionLine, draft: RowDraft): Record<string, string> => {
    if (rowKind(line) === "fileOnly") return {};
    const errors = draft.nothing ? {} : validateFields(line, draft.values);
    if (line.entryPolicy !== "single") {
      const dateError = validateEntryDate(draft.date, today, batch.startDate);
      if (dateError) errors.date = dateError;
    }
    return errors;
  };
  const statuses: RowStatus[] = openLines
    .filter((line) => touched(line, draftOf(line)))
    .map((line) => ({ line, draft: draftOf(line), errors: validate(line, draftOf(line)) }));
  const ready = statuses.filter((status) => !Object.keys(status.errors).length);
  const missingFile = ready.filter((status) => rowKind(status.line) === "value" && !status.draft.nothing && !status.draft.file).length;
  const failing = statuses.length - ready.length + Object.keys(serverErrors).length;

  const saveRow = async ({ line, draft }: RowStatus) => {
    const kind = rowKind(line);
    if (kind === "fileOnly") {
      const entry = entryMissingFile(line);
      if (!entry || !draft.file) return;
      await upload({ entityType: ENTRY_ENTITY_TYPE, entityId: entry.id, documentType: entryDocumentType(draft.file), file: draft.file });
      return;
    }
    const occurredOn = line.entryPolicy === "single" ? undefined : draft.date;
    if (draft.nothing) {
      await markNothing.mutateAsync({ ...scope, componentId: line.componentId, note: draft.note.trim() || null, occurredOn });
      return;
    }
    const created = await createEntry.mutateAsync({
      creditBatchId: scope.creditBatchId,
      componentId: line.componentId,
      occurredOn,
      note: null,
      values: entryValues(line, draft.values),
    });
    if (draft.file) {
      try {
        await upload({ entityType: ENTRY_ENTITY_TYPE, entityId: created.id, documentType: entryDocumentType(draft.file), file: draft.file });
      } catch {
        // The entry is saved; its row shows File missing with Attach file again.
        throw new Error(`The manual entry was saved. ${FILE_FALLBACK}`);
      }
    }
  };

  const saveAll = async () => {
    setAttempted(true);
    const invalid = statuses.find((status) => Object.keys(status.errors).length);
    if (invalid) {
      const key = Object.keys(invalid.errors)[0];
      const target = document.getElementById(`month-${invalid.line.componentId}-${key}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "center" });
    }
    if (!ready.length) return;
    setSaving(true);
    const nextErrors: Record<string, string> = {};
    const savedIds: string[] = [];
    let entries = 0;
    let nothings = 0;
    let files = 0;
    for (const status of ready) {
      try {
        await saveRow(status);
        savedIds.push(status.line.componentId);
        if (rowKind(status.line) === "fileOnly") files += 1;
        else if (status.draft.nothing) nothings += 1;
        else entries += 1;
      } catch (error) {
        nextErrors[status.line.componentId] = toSaveErrorMessage(error, SAVE_FALLBACK);
      }
    }
    await invalidateEmissionEntryReads(queryClient, scope);
    setSaving(false);
    setServerErrors(nextErrors);
    setDrafts((all) => Object.fromEntries(Object.entries(all).filter(([id]) => !savedIds.includes(id))));
    const parts = [
      entries ? `${entries} ${pluralize(entries, "manual entry", "manual entries")}` : "",
      nothings ? `${nothings} ${pluralize(nothings, "line")} marked Nothing to record` : "",
      files ? `${files} ${pluralize(files, "file")} added` : "",
    ].filter(Boolean);
    if (parts.length) toast.success(`Saved ${parts.join(", ")}.`);
    if (!invalid && !Object.keys(nextErrors).length) onDone();
  };

  const confirmLine = async (line: EmissionLine) => {
    const entry = stoppedEntries(line)[0];
    if (!entry) return;
    setConfirming(line.componentId);
    try {
      await confirmEntry.mutateAsync({ id: entry.id, expectedVersion: entry.version });
      toast.success(`Manual entry confirmed on ${line.displayName}.`);
    } catch (error) {
      setServerErrors((all) => ({ ...all, [line.componentId]: toSaveErrorMessage(error, "The manual entry was not confirmed. Try again.") }));
    } finally {
      setConfirming(null);
    }
  };

  const statusText = [
    ready.length ? `${ready.length} ${pluralize(ready.length, "line")} ready` : "No lines ready yet",
    missingFile ? `${missingFile} missing a file` : "",
    attempted && failing ? `${failing} to fix` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section aria-labelledby="record-month-title" className="flex flex-col gap-12">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="record-month-title" className="body-large font-medium">{`Open lines, ${openLines.length}`}</h2>
          <p className="body-caption text-[var(--color-text-secondary)]">
            Fill what you have. Lines you leave empty stay open. Records stay as they are; what you type adds on top.
          </p>
        </div>
        <Button variant="weak" aria-pressed={showDone} onClick={() => setShowDone((shown) => !shown)}>
          {showDone ? "Hide done lines" : `Show done lines (${doneLines.length})`}
        </Button>
      </div>
      <div className="bg-[var(--paper)] [border:var(--panel-border)]">
        {/* Locked while Save all runs, so a draft typed mid-save is neither saved stale nor dropped. */}
        <fieldset disabled={saving} className="min-w-0">
          <ul aria-label="Open lines">
            {openLines.map((line) => (
              <RecordMonthRow
                key={line.componentId}
                line={line}
                scope={scope}
                draft={draftOf(line)}
                errors={attempted && touched(line, draftOf(line)) ? validate(line, draftOf(line)) : {}}
                serverError={serverErrors[line.componentId] ?? null}
                today={today}
                startDate={batch.startDate}
                onChange={(change) => {
                  patch(line, change);
                  if (serverErrors[line.componentId]) {
                    setServerErrors((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== line.componentId)));
                  }
                }}
                onConfirm={(target) => void confirmLine(target)}
                onEnterAgain={onEnterAgain}
                confirming={confirming === line.componentId}
              />
            ))}
          </ul>
        </fieldset>
        {showDone && (
          <>
            <p className="bg-[var(--sea)] px-16 py-8 body-caption font-medium text-[var(--color-text-tertiary)] [border-top:var(--row-divider)]">Done lines</p>
            <ul aria-label="Done lines">
              {doneLines.map((line) => (
                <li
                  key={line.componentId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-12 gap-y-6 px-16 py-10 body-small [border-top:var(--row-divider)] md:grid-cols-[minmax(0,1.25fr)_148px_minmax(0,1fr)_168px]"
                >
                  <span className="min-w-0">{line.displayName}</span>
                  <span className="justify-self-end md:justify-self-start"><EmissionLineBadge state={line.state} /></span>
                  <span className="col-span-2 md:col-span-1"><SourceChips line={line} ids={scope} interactive={false} /></span>
                  <span className="hidden text-right tabular-nums text-[var(--color-text-secondary)] md:block">{lineTotalText(line)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="sticky bottom-0 z-10 -mx-16 flex flex-col gap-8 border-t border-[var(--color-border-primary)] bg-[var(--paper)] px-16 py-10 sm:mx-0 sm:border">
        {gapLines.length > 0 && (
          <Notice tone="warning">
            {`${gapLines.length} ${pluralize(gapLines.length, "line has", "lines have")} a records source with nothing recorded. Fuel used in a run belongs on that run, a delivery on its own record.`}
          </Notice>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-8">
          <p role="status" className={cn("body-small font-medium", attempted && failing > 0 && "text-[var(--st-bad)]")}>{statusText}</p>
          <div className="flex gap-8">
            <Button variant="weak" onClick={onDone} disabled={saving}>Cancel</Button>
            <Button variant="primary" busy={saving} disabled={!statuses.length} onClick={() => void saveAll()}>Save all</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
