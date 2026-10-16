/**
 * Add, edit or re-enter one manual entry, inside the line drawer. Header,
 * the fields for the line's shape, the file, an optional note, Cancel / Save.
 *
 * Shapes: one value with its unit; mass and distance with the computed
 * t·km; and the paired concentration and mass flow of a `single` line, which
 * has no date because the entry counts for the whole credit batch.
 */
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { FormField } from "@/components/forms/form-field";
import { FormFileUpload } from "@/components/forms/form-file-upload";
import { FormTextarea } from "@/components/forms/form-textarea";
import { ServerError } from "@/components/forms/server-error";
import { Button, Input, Notice } from "@/components/ui";
import {
  SlideOverPanelBody,
  SlideOverPanelDescription,
  SlideOverPanelFooter,
  SlideOverPanelHeader,
  SlideOverPanelTitle,
} from "@/components/ui/slide-over-panel";
import { useDeferredAttachments } from "@/hooks/use-deferred-attachments";
import {
  useCreateEmissionEntry,
  useDeleteEmissionEntry,
  useUpdateEmissionEntry,
  type EmissionBatchScope,
  invalidateEmissionEntryReads,
} from "@/hooks/use-emission-entries";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { EntryFileNames, ENTRY_ENTITY_TYPE } from "./emission-entry-files";
import {
  ENTRY_FILE_ACCEPT,
  MAX_NOTE_LENGTH,
  NOTE_TOO_LONG_MESSAGE,
  SINGLE_LINE_CAPTION,
  defaultEntryDate,
  draftFromEntry,
  draftMassDistanceFigure,
  entryDocumentType,
  entryFields,
  entryValues,
  nothingEntry,
  validateEntryDate,
  validateFields,
  type EmissionBatch,
  type EmissionEntry,
  type EmissionLine,
} from "./emission-line-display";

export type EntryFormMode =
  | { kind: "add" }
  | { kind: "edit"; entry: EmissionEntry }
  /** Re-enter a stopped entry: save a new one, then delete the old. */
  | { kind: "again"; entry: EmissionEntry };

const TITLES: Record<EntryFormMode["kind"], string> = {
  add: "Add manual entry",
  edit: "Edit manual entry",
  again: "Enter again",
};
const SAVE_FALLBACK = "The manual entry was not saved. Check the values and try again.";
const FILE_NOT_UPLOADED = "The file did not upload. Open the entry and add it again.";

interface ManualEntryFormProps {
  line: EmissionLine;
  batch: EmissionBatch;
  scope: EmissionBatchScope;
  /** Today on the facility clock, YYYY-MM-DD. */
  today: string;
  mode: EntryFormMode;
  onCancel: () => void;
  /** Called after a save; `warning` is set when the entry saved but its file did not. */
  onSaved: (result: { warning?: string }) => void;
}

export function ManualEntryForm({ line, batch, scope, today, mode, onCancel, onSaved }: ManualEntryFormProps) {
  const seed = mode.kind === "add" ? undefined : mode.entry;
  const single = line.entryPolicy === "single";
  const fields = entryFields(line);
  const [draft, setDraft] = useState<Record<string, string>>(() => (seed ? draftFromEntry(seed) : {}));
  const [date, setDate] = useState(() => (mode.kind === "edit" ? mode.entry.occurredOn : defaultEntryDate(today, batch)));
  const [note, setNote] = useState(seed?.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const attachments = useDeferredAttachments();
  const queryClient = useQueryClient();
  const createEntry = useCreateEmissionEntry(scope);
  const updateEntry = useUpdateEmissionEntry(scope);
  const deleteEntry = useDeleteEmissionEntry(scope);
  const saving = createEntry.isPending || updateEntry.isPending || deleteEntry.isPending || attachments.attachments.some((a) => a.status === "uploading");
  const replacesNothing = mode.kind !== "edit" && !!nothingEntry(line);
  const computed = draftMassDistanceFigure(line, draft);
  const idPrefix = `entry-${line.componentId}`;
  // Pending flags update after a render; this blocks a second Enter or click in the same tick.
  const inFlight = useRef(false);

  const save = async () => {
    if (inFlight.current) return;
    const next = validateFields(line, draft);
    const dateError = single ? null : validateEntryDate(date, today, batch.startDate);
    if (dateError) next.date = dateError;
    const trimmedNote = note.trim() || null;
    // Checked here so Enter again never deletes the stopped entry before a create the server refuses.
    if (trimmedNote && trimmedNote.length > MAX_NOTE_LENGTH) next.note = NOTE_TOO_LONG_MESSAGE;
    setErrors(next);
    setServerError(null);
    if (Object.keys(next).length) {
      document.getElementById(`${idPrefix}-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    const values = entryValues(line, draft);
    const occurredOn = single ? undefined : date;
    inFlight.current = true;
    try {
      let entryId: string;
      if (mode.kind === "edit") {
        const saved = await updateEntry.mutateAsync({ id: mode.entry.id, expectedVersion: mode.entry.version, occurredOn, note: trimmedNote, values });
        entryId = saved.id;
      } else {
        // A single line allows one value entry, so the stopped one goes first.
        if (mode.kind === "again" && single) await deleteEntry.mutateAsync({ id: mode.entry.id, expectedVersion: mode.entry.version });
        const created = await createEntry.mutateAsync({ creditBatchId: scope.creditBatchId, componentId: line.componentId, occurredOn, note: trimmedNote, values });
        if (mode.kind === "again" && !single) await deleteEntry.mutateAsync({ id: mode.entry.id, expectedVersion: mode.entry.version });
        entryId = created.id;
      }
      if (attachments.hasHeld) {
        const flushed = await attachments.flush(ENTRY_ENTITY_TYPE, entryId);
        // Attaching a file moves the entry's version and file count after the save refreshed the lines.
        await invalidateEmissionEntryReads(queryClient, scope);
        if (!flushed.ok) {
          onSaved({ warning: FILE_NOT_UPLOADED });
          return;
        }
      }
      onSaved({});
    } catch (error) {
      setServerError(toSaveErrorMessage(error, SAVE_FALLBACK));
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <>
      <SlideOverPanelHeader>
        <div className="flex min-w-0 flex-col gap-2">
          <SlideOverPanelTitle>{TITLES[mode.kind]}</SlideOverPanelTitle>
          <SlideOverPanelDescription>{`${line.displayName}, ${batch.code}`}</SlideOverPanelDescription>
        </div>
      </SlideOverPanelHeader>
      <SlideOverPanelBody>
        <form
          noValidate
          className="flex flex-col gap-20"
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving) void save();
          }}
        >
          {replacesNothing && <Notice tone="warning">{`This replaces Nothing to record on ${line.displayName}.`}</Notice>}
          {mode.kind === "again" && (
            <p className="body-small text-[var(--color-text-secondary)]">
              The earlier entry stopped counting after a template change. Saving replaces it.
            </p>
          )}
          <div className={fields.length > 1 ? "grid grid-cols-1 gap-x-16 gap-y-20 sm:grid-cols-2" : "flex flex-col"}>
            {fields.map((field, index) => (
              <FormField
                key={field.key}
                id={`${idPrefix}-${field.key}`}
                label={field.label}
                unit={field.unit}
                error={errors[field.key]}
                cue={field.part === "distance" && computed ? `This entry: ${computed}` : undefined}
              >
                <Input
                  id={`${idPrefix}-${field.key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus={index === 0}
                  value={draft[field.key] ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </FormField>
            ))}
          </div>
          {single ? (
            <p className="body-caption text-[var(--color-text-secondary)]">{SINGLE_LINE_CAPTION}</p>
          ) : (
            <FormField id={`${idPrefix}-date`} label="Date" error={errors.date}>
              <Input
                id={`${idPrefix}-date`}
                type="date"
                value={date}
                min={batch.startDate}
                max={today}
                onChange={(event) => setDate(event.target.value)}
              />
            </FormField>
          )}
          <FormField id={`${idPrefix}-file`} label="File" certifyRequired>
            <div className="flex flex-col gap-8">
              {mode.kind === "edit" && mode.entry.documentCount > 0 && <EntryFileNames entry={mode.entry} />}
              <FormFileUpload
                id={`${idPrefix}-file`}
                accept={ENTRY_FILE_ACCEPT}
                deferred
                deferredFiles={attachments.attachments}
                onDeferredAdd={(files) => files.forEach((file) => attachments.add([file], entryDocumentType(file)))}
                onDeferredRemove={attachments.remove}
              />
            </div>
          </FormField>
          <FormField id={`${idPrefix}-note`} label="Note" error={errors.note}>
            <FormTextarea id={`${idPrefix}-note`} value={note} onChange={(event) => setNote(event.target.value)} />
          </FormField>
          {serverError && <ServerError message={serverError} />}
          {/* Lets Enter in a field submit; the visible buttons sit in the footer. */}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} disabled={saving} />
        </form>
      </SlideOverPanelBody>
      <SlideOverPanelFooter>
        <Button variant="weak" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button variant="primary" busy={saving} onClick={() => void save()}>Save</Button>
      </SlideOverPanelFooter>
    </>
  );
}
