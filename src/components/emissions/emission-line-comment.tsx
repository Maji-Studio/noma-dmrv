/**
 * The line comment inside an open row: one editable comment per line. It
 * belongs to the line, not to a manual entry (entries keep their own note),
 * stays in noma and never changes a line's state. Earlier wording lives in
 * the activity log.
 *
 * It reads as one more row on the sources table's grid: "Comment" under
 * Source, the words across Date to Amount, its own ⋯ (Edit comment, Delete
 * comment) under the other ⋯. Editing keeps the same place: the label stays,
 * the words become the text box.
 */
"use client";

import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChatTextIcon } from "@phosphor-icons/react/dist/ssr";
import { FormError } from "@/components/forms/form-error";
import { FormTextarea } from "@/components/forms/form-textarea";
import { ServerError } from "@/components/forms/server-error";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { Button } from "@/components/ui";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { useDeleteEmissionLineComment, useSetEmissionLineComment } from "@/hooks/use-emission-line-comments";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { cn } from "@/lib/utils";
import {
  emissionLineCommentFormSchema,
  type EmissionLineCommentFormData,
  type EmissionLineCommentFormInput,
} from "@/schemas/emission-entry-form";
import { EntryMenu } from "./emission-ledger-entries";
import { ICON } from "./emission-line-body-parts";
import type { EmissionLine } from "./emission-line-display";
import { MENU_PULL, NAME_INSET, TABLE_ROW } from "./emission-line-grid";

const SAVE_FALLBACK = "The comment was not saved. Try again.";
const DELETE_FALLBACK = "The comment was not deleted. Try again.";
/** The comment row opens with a row divider, like every row of the sources table above it. */
const COMMENT_ROW = cn(TABLE_ROW, "[border-top:var(--row-divider)]");

const LABEL_CELL = cn("col-span-2 col-start-1 row-start-1 inline-flex items-center gap-6 self-start py-10 body-small text-[var(--color-text-secondary)] md:col-span-1", NAME_INSET);
/** Phones: under the label, full width; wide: from Date across to Amount. */
const BODY_CELL = cn("col-span-3 col-start-1 row-start-2 min-w-0 pb-10 md:col-span-3 md:col-start-2 md:row-start-1 md:py-10 md:pl-0", NAME_INSET);
const MENU_CELL = cn("col-start-3 row-start-1 md:col-start-5 -mt-2 flex justify-end self-start", MENU_PULL);

interface LineCommentProps {
  line: EmissionLine;
  scope: EmissionBatchScope;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}

/** The comment row: the saved comment, or its editor while adding or editing. Nothing when there is neither. */
export function LineComment({ line, scope, editing, onEditingChange }: LineCommentProps) {
  if (editing) {
    return <CommentEditor line={line} scope={scope} onDone={() => onEditingChange(false)} />;
  }
  if (!line.comment) return null;
  return <CommentView line={line} scope={scope} onEdit={() => onEditingChange(true)} />;
}

function CommentLabel({ htmlFor }: { htmlFor?: string }) {
  const content = (
    <>
      <ChatTextIcon size={ICON} aria-hidden="true" className="shrink-0" />
      Comment
    </>
  );
  return htmlFor ? <label htmlFor={htmlFor} className={LABEL_CELL}>{content}</label> : <span className={LABEL_CELL}>{content}</span>;
}

function CommentView({ line, scope, onEdit }: { line: EmissionLine; scope: EmissionBatchScope; onEdit: () => void }) {
  const remove = useCommentDelete(line, scope);
  const comment = line.comment;
  if (!comment) return null;
  return (
    <div className={COMMENT_ROW}>
      <CommentLabel />
      <p className={cn(BODY_CELL, "body-small whitespace-pre-line break-words")}>
        <span className="sr-only">Comment: </span>
        {comment.body}
      </p>
      <span className={MENU_CELL}>
        <EntryMenu
          label="Actions for the comment"
          items={[
            { label: "Edit comment", onSelect: onEdit },
            { label: "Delete comment", onSelect: remove.request, destructive: true },
          ]}
        />
      </span>
      {remove.dialog}
    </div>
  );
}

/**
 * Delete for the line comment: `request` opens the confirm dialog, render `dialog` once.
 * The dialog keeps the comment it opened on (id, version): a refresh after a refused
 * delete never retargets it. Cancel and delete again to act on the latest comment.
 */
export function useCommentDelete(line: EmissionLine, scope: EmissionBatchScope) {
  const toast = useToast();
  const remove = useDeleteEmissionLineComment(scope);
  const [target, setTarget] = useState<{ id: string; version: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirmDelete = async () => {
    if (!target) return;
    setError(null);
    try {
      await remove.mutateAsync({ facilityId: scope.facilityId, id: target.id, expectedVersion: target.version });
      setTarget(null);
      toast.success(`Comment deleted on ${line.displayName}.`);
    } catch (caught) {
      setError(toSaveErrorMessage(caught, DELETE_FALLBACK));
    }
  };
  const dialog = (
    <DeleteConfirmDialog
      isOpen={!!target}
      title="Delete this comment?"
      message={`The comment on ${line.displayName} is removed. Earlier wording stays in the activity log.`}
      onConfirm={() => void confirmDelete()}
      onCancel={() => setTarget(null)}
      isPending={remove.isPending}
      errorMessage={error ?? undefined}
    />
  );
  return {
    request: () => {
      if (!line.comment) return;
      setError(null);
      setTarget({ id: line.comment.id, version: line.comment.version });
    },
    dialog,
  };
}

/**
 * The editor keeps the comment it opened on (id, version, words) for the whole
 * edit: a refresh or a refused save never swaps the target or drops the draft.
 * A conflict keeps the draft; Cancel and edit again to start from the latest.
 */
function CommentEditor({ line, scope, onDone }: { line: EmissionLine; scope: EmissionBatchScope; onDone: () => void }) {
  const save = useSetEmissionLineComment(scope);
  const [opened] = useState(() => (line.comment ? { id: line.comment.id, version: line.comment.version } : null));
  const [error, setError] = useState<string | null>(null);
  const latched = useLatchedSubmit();
  const formId = useId();
  const {
    register,
    handleSubmit,
    control,
    setError: setFieldError,
    setFocus,
    resetField,
    formState: { errors },
  } = useForm<EmissionLineCommentFormInput, unknown, EmissionLineCommentFormData>({
    resolver: zodResolver(emissionLineCommentFormSchema),
    defaultValues: { body: line.comment?.body ?? "" },
  });
  const refuseSave = useSaveRefusal({ control, setError: setFieldError, resetField, formId });
  const id = `comment-${line.componentId}`;
  const fieldError = errors.body?.message;
  const saveComment = handleSubmit(async ({ body }) => {
    try {
      await save.mutateAsync({
        facilityId: scope.facilityId,
        creditBatchId: scope.creditBatchId,
        componentId: line.componentId,
        body,
        ...(opened ? { id: opened.id, expectedVersion: opened.version } : {}),
      });
      onDone();
    } catch (caught) {
      const footer = refuseSave(caught, toSaveErrorMessage(caught, SAVE_FALLBACK));
      setError(footer);
      // With the refusal at the field, focus would stay on Save, possibly out of view.
      if (footer === null) setFocus("body");
    }
  });
  const submit = latched(async (event: React.FormEvent<HTMLFormElement>) => {
    setError(null);
    await saveComment(event);
  });
  return (
    <form id={formId} noValidate className={COMMENT_ROW} onSubmit={submit}>
      <CommentLabel htmlFor={id} />
      <div className={cn(BODY_CELL, "flex flex-col gap-8")}>
        <div>
          <FormTextarea
            id={id}
            autoFocus
            error={!!fieldError}
            aria-describedby={fieldError ? `${id}-error` : undefined}
            {...register("body")}
          />
          <FormError id={`${id}-error`} message={fieldError} />
        </div>
        {error && <ServerError message={error} />}
        <div className="flex flex-wrap gap-8">
          <Button size="small" variant="primary" type="submit" busy={save.isPending}>Save comment</Button>
          <Button size="small" variant="weak" onClick={onDone} disabled={save.isPending}>Cancel</Button>
        </div>
      </div>
    </form>
  );
}
