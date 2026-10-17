/**
 * The line comment inside an expanded row: one editable comment per line.
 * It belongs to the line, not to a manual entry (entries keep their own
 * note), stays in noma and never changes a line's state. Earlier wording
 * lives in the activity log.
 */
"use client";

import { useState } from "react";
import { ChatTextIcon } from "@phosphor-icons/react/dist/ssr";
import { FormTextarea } from "@/components/forms/form-textarea";
import { ServerError } from "@/components/forms/server-error";
import { Button } from "@/components/ui";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useDeleteEmissionLineComment, useSetEmissionLineComment } from "@/hooks/use-emission-line-comments";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { MAX_NOTE_LENGTH, NOTE_TOO_LONG_MESSAGE, type EmissionLine } from "./emission-line-display";

const EMPTY_MESSAGE = "Enter a comment.";
const SAVE_FALLBACK = "The comment was not saved. Try again.";
const DELETE_FALLBACK = "The comment was not deleted. Try again.";

interface EmissionLineCommentProps {
  line: EmissionLine;
  scope: EmissionBatchScope;
  canWrite: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}

export function EmissionLineComment({ line, scope, canWrite, editing, onEditingChange }: EmissionLineCommentProps) {
  const comment = line.comment;
  if (editing && canWrite) {
    return <CommentEditor key={comment?.version ?? "new"} line={line} scope={scope} onDone={() => onEditingChange(false)} />;
  }
  if (!comment) {
    return canWrite ? (
      <div>
        <Button size="small" variant="weak" onClick={() => onEditingChange(true)}>
          Comment
        </Button>
      </div>
    ) : null;
  }
  return <CommentView line={line} scope={scope} canWrite={canWrite} onEdit={() => onEditingChange(true)} />;
}

function CommentView({ line, scope, canWrite, onEdit }: { line: EmissionLine; scope: EmissionBatchScope; canWrite: boolean; onEdit: () => void }) {
  const toast = useToast();
  const remove = useDeleteEmissionLineComment(scope);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comment = line.comment;
  if (!comment) return null;
  const confirmDelete = async () => {
    setError(null);
    try {
      await remove.mutateAsync({ facilityId: scope.facilityId, id: comment.id, expectedVersion: comment.version });
      setConfirming(false);
      toast.success(`Comment deleted on ${line.displayName}.`);
    } catch (caught) {
      setError(toSaveErrorMessage(caught, DELETE_FALLBACK));
    }
  };
  return (
    <div className="flex flex-col gap-8">
      <p className="flex items-start gap-8 body-small whitespace-pre-line">
        <ChatTextIcon size={16} aria-hidden="true" className="mt-2 shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="min-w-0 break-words">{comment.body}</span>
      </p>
      {canWrite && (
        <div className="flex flex-wrap gap-8">
          <Button size="small" variant="weak" onClick={onEdit}>Edit comment</Button>
          <Button size="small" variant="weak" onClick={() => { setError(null); setConfirming(true); }}>Delete</Button>
        </div>
      )}
      <DeleteConfirmDialog
        isOpen={confirming}
        title="Delete this comment?"
        message={`The comment on ${line.displayName} is removed. Earlier wording stays in the activity log.`}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirming(false)}
        isPending={remove.isPending}
        errorMessage={error ?? undefined}
      />
    </div>
  );
}

function CommentEditor({ line, scope, onDone }: { line: EmissionLine; scope: EmissionBatchScope; onDone: () => void }) {
  const save = useSetEmissionLineComment(scope);
  const comment = line.comment;
  const [body, setBody] = useState(comment?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const id = `comment-${line.componentId}`;
  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return setError(EMPTY_MESSAGE);
    if (trimmed.length > MAX_NOTE_LENGTH) return setError(NOTE_TOO_LONG_MESSAGE);
    setError(null);
    try {
      await save.mutateAsync({
        facilityId: scope.facilityId,
        creditBatchId: scope.creditBatchId,
        componentId: line.componentId,
        body: trimmed,
        ...(comment ? { id: comment.id, expectedVersion: comment.version } : {}),
      });
      onDone();
    } catch (caught) {
      setError(toSaveErrorMessage(caught, SAVE_FALLBACK));
    }
  };
  return (
    <form
      noValidate
      className="flex flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending) void submit();
      }}
    >
      <label htmlFor={id} className="body-small font-medium">Comment</label>
      <FormTextarea
        id={id}
        autoFocus
        error={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      {error && <div id={`${id}-error`}><ServerError message={error} /></div>}
      <div className="flex flex-wrap gap-8">
        <Button size="small" variant="primary" type="submit" busy={save.isPending}>Save comment</Button>
        <Button size="small" variant="weak" onClick={onDone} disabled={save.isPending}>Cancel</Button>
      </div>
    </form>
  );
}
