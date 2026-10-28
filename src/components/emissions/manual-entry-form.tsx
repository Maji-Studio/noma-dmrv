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
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField } from "@/components/forms/form-field";
import { FormFileUpload } from "@/components/forms/form-file-upload";
import { FormTextarea } from "@/components/forms/form-textarea";
import { ServerError } from "@/components/forms/server-error";
import { Button, Input } from "@/components/ui";
import {
  SlideOverPanelBody,
  SlideOverPanelDescription,
  SlideOverPanelFooter,
  SlideOverPanelHeader,
  SlideOverPanelTitle,
} from "@/components/ui/slide-over-panel";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { useDeferredAttachments } from "@/hooks/use-deferred-attachments";
import {
  useCreateEmissionEntry,
  useReplaceEmissionEntry,
  useUpdateEmissionEntry,
  type EmissionBatchScope,
  invalidateEmissionEntryReads,
} from "@/hooks/use-emission-entries";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { CreditBatchLine } from "@/components/credit-batches/credit-batch-line";
import { describeEmissionEntryCreditBatchLine } from "./emission-entry-credit-batch-line-copy";
import { EntryFileNames, ENTRY_ENTITY_TYPE } from "./emission-entry-files";
import {
  ENTRY_FILE_ACCEPT,
  SINGLE_LINE_CAPTION,
  defaultEntryDate,
  draftFromEntry,
  draftMassDistanceFigure,
  entryDocumentType,
  entryFields,
  entryRefusalAliases,
  entryValues,
  inputShapeKey,
  UNITS_CHANGED_MESSAGE,
  type EmissionBatch,
  type EmissionEntry,
  type EmissionLine,
} from "./emission-line-display";
import {
  emissionEntryFormSchema,
  entryFieldName,
  type EmissionEntryFormData,
  type EmissionEntryFormInput,
} from "@/schemas/emission-entry-form";
import { TOP_REFUSAL_TITLE, TopRefusalBox } from "@/components/forms/form-actions";
import { ResolvedErrorRevalidator } from "@/components/forms/resolved-error-revalidator";
import { isActionError } from "@/lib/action-error";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { readFieldDirectory, type FieldDirectory } from "@/components/forms/form-error-summary-dom";

export type EntryFormMode =
  | { kind: "add" }
  | { kind: "edit"; entry: EmissionEntry }
  /** Re-enter a stopped entry: one replace call; its files move to the new entry. */
  | { kind: "again"; entry: EmissionEntry };

const TITLES: Record<EntryFormMode["kind"], string> = {
  add: "Add manual entry",
  edit: "Edit manual entry",
  again: "Enter again",
};
const SAVE_FALLBACK = "The manual entry was not saved. Check the values and try again.";
const LOCK_CODE = "certification_locked";
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
  const formId = useId();
  const latched = useLatchedSubmit();
  const seedDraft = seed ? draftFromEntry(seed, line) : {};
  const {
    register,
    handleSubmit,
    control,
    setError,
    setValue,
    clearErrors,
    resetField,
    trigger,
    formState: { errors },
  } = useForm<EmissionEntryFormInput, unknown, EmissionEntryFormData>({
    resolver: zodResolver(
      emissionEntryFormSchema({ fieldCount: fields.length, dated: !single, today, startDate: batch.startDate }),
    ),
    defaultValues: {
      ...Object.fromEntries(fields.map((field, index) => [entryFieldName(index), seedDraft[field.key] ?? ""])),
      date: mode.kind === "edit" ? mode.entry.occurredOn : defaultEntryDate(today, batch),
      note: seed?.note ?? "",
    },
  });
  // The units the draft was typed in: a template refresh must never reinterpret the numbers.
  const [typedIn, setTypedIn] = useState(() => inputShapeKey(line));
  const [serverError, setServerError] = useState<string | null>(null);
  // The whole entry is reserved or sent: the form turns read-only and the refusal moves to the top.
  const [locked, setLocked] = useState(false);
  // Labels and order of the controls, read when Save is pressed, for the error summary.
  const [directory, setDirectory] = useState<FieldDirectory | null>(null);
  const attachments = useDeferredAttachments();
  const queryClient = useQueryClient();
  // Each form mount scopes a fresh create intent key to this draft.
  const createEntry = useCreateEmissionEntry(scope);
  const updateEntry = useUpdateEmissionEntry(scope);
  const replaceEntry = useReplaceEmissionEntry(scope);
  const saving = createEntry.isPending || updateEntry.isPending || replaceEntry.isPending || attachments.attachments.some((a) => a.status === "uploading");
  const watched = useWatch({ control });
  /** The typed values keyed by the template's field keys, as the display helpers read them. */
  const draftOf = (values: Record<string, string | undefined>) =>
    Object.fromEntries(fields.map((field, index) => [field.key, values[entryFieldName(index)] ?? ""]));
  const computed = draftMassDistanceFigure(line, draftOf(watched));
  const idPrefix = `entry-${line.componentId}`;
  const refuseSave = useSaveRefusal({ control, setError, resetField, formId, aliases: entryRefusalAliases(line) });

  const save = handleSubmit(async (data) => {
    const draft = draftOf(data);
    const note = (data.note ?? "").trim() || null;
    const values = entryValues(line, draft);
    const occurredOn = single ? undefined : data.date;
    try {
      let entryId: string;
      if (mode.kind === "edit") {
        const saved = await updateEntry.mutateAsync({ id: mode.entry.id, expectedVersion: mode.entry.version, occurredOn, note, values });
        entryId = saved.id;
      } else if (mode.kind === "again") {
        const replaced = await replaceEntry.mutateAsync({ id: mode.entry.id, expectedVersion: mode.entry.version, occurredOn, note, values });
        entryId = replaced.id;
      } else {
        const created = await createEntry.mutateAsync({ creditBatchId: scope.creditBatchId, componentId: line.componentId, occurredOn, note, values });
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
      const footer = refuseSave(error, toSaveErrorMessage(error, SAVE_FALLBACK));
      setServerError(footer);
      // The lock names no field (lockWritableEmissionEntry), so the footer carries it.
      if (footer !== null && isActionError(error) && error.code === LOCK_CODE) {
        // Back to the saved entry: nothing typed or attached was saved. Field by field, not
        // `reset()`: that resets the whole <form> element and left the date input blank in the browser.
        for (const name of [...fields.map((_, index) => entryFieldName(index)), "date", "note"]) {
          resetField(name, { keepError: true });
        }
        attachments.clear();
        setLocked(true);
      }
    }
  });

  // The latch holds across validation and the awaited save, before a render shows the pending flags.
  const submit = latched(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setServerError(null);
    setDirectory(readFieldDirectory(event.currentTarget));
    if (inputShapeKey(line) !== typedIn) {
      setTypedIn(inputShapeKey(line));
      fields.forEach((_, index) => setValue(entryFieldName(index), ""));
      clearErrors();
      setServerError(UNITS_CHANGED_MESSAGE);
      return;
    }
    await save(event);
  });

  return (
    <>
      <SlideOverPanelHeader>
        <div className="flex min-w-0 flex-col gap-2">
          <SlideOverPanelTitle>{TITLES[mode.kind]}</SlideOverPanelTitle>
          <SlideOverPanelDescription>{`${line.displayName}, ${batch.code}`}</SlideOverPanelDescription>
        </div>
      </SlideOverPanelHeader>
      <SlideOverPanelBody>
        <form id={formId} noValidate className="flex flex-col gap-20" onSubmit={submit}>
          {locked && serverError && <TopRefusalBox locked={false} lead={TOP_REFUSAL_TITLE} message={serverError} />}
          <ResolvedErrorRevalidator control={control} trigger={trigger} />
          {/* `contents` keeps the fields laid out as before; disabled makes the locked form read-only. */}
          <fieldset disabled={locked} className="contents">
          {mode.kind === "again" && (
            <p className="body-small text-[var(--color-text-secondary)]">
              The earlier entry stopped counting after a template change. Saving replaces it and keeps its files.
            </p>
          )}
          <div className={fields.length > 1 ? "grid grid-cols-1 gap-x-16 gap-y-20 sm:grid-cols-2" : "flex flex-col"}>
            {fields.map((field, index) => (
              <FormField
                key={field.key}
                id={`${idPrefix}-${field.key}`}
                label={field.label}
                unit={field.unit}
                error={errors[entryFieldName(index)]?.message}
                cue={field.part === "distance" && computed ? `This entry: ${computed}` : undefined}
              >
                <Input
                  id={`${idPrefix}-${field.key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus={index === 0}
                  {...register(entryFieldName(index))}
                />
              </FormField>
            ))}
          </div>
          {single ? (
            <p className="body-caption text-[var(--color-text-secondary)]">{SINGLE_LINE_CAPTION}</p>
          ) : (
            <FormField id={`${idPrefix}-date`} label="Date" error={errors.date?.message}>
              <Input
                id={`${idPrefix}-date`}
                type="date"
                min={batch.startDate}
                max={today}
                {...register("date")}
              />
            </FormField>
          )}
          <FormField id={`${idPrefix}-file`} label="File" certifyRequired>
            <div className="flex flex-col gap-8">
              {mode.kind !== "add" && mode.entry.documentCount > 0 && <EntryFileNames entry={mode.entry} />}
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
          <FormField id={`${idPrefix}-note`} label="Note" error={errors.note?.message}>
            <FormTextarea id={`${idPrefix}-note`} {...register("note")} />
          </FormField>
          </fieldset>
          {!locked && (
            <FormErrorSummary
              control={control}
              directory={directory}
              getForm={() => document.getElementById(formId)}
              message={serverError ?? undefined}
            />
          )}
        </form>
      </SlideOverPanelBody>
      <SlideOverPanelFooter
        preview={<CreditBatchLine copy={describeEmissionEntryCreditBatchLine(batch)} facilityId={scope.facilityId} />}
      >
        <Button variant="weak" onClick={onCancel} disabled={saving}>{locked ? "Close" : "Cancel"}</Button>
        {!locked && <Button variant="primary" type="submit" form={formId} busy={saving}>Save</Button>}
      </SlideOverPanelFooter>
    </>
  );
}
