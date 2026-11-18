/**
 * The proof files of a component's From records amount (#1519), in the same
 * "Files and note" slot an entry has: the file names, File missing, Add file
 * and its upload. The row's ⋯ menu removes a file or, while Isometric has the
 * Removal returned, replaces the whole set. A locked set (the Removal claimed
 * or reserved, no correction window) shows its files and nothing to change.
 */
"use client";

import { useState } from "react";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { ConfirmActionDialog } from "@/components/certification/confirm-action-dialog";
import { FormFileUpload } from "@/components/forms/form-file-upload";
import { ServerError } from "@/components/forms/server-error";
import { Button } from "@/components/ui";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { invalidateEmissionEntryReads } from "@/hooks/stale-reads";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import { useEmissionLineFileUploadRequest, useRemoveEmissionLineFile, useReplaceEmissionLineFiles } from "@/hooks/use-emission-line-files";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import type { EntryMenuItem } from "./emission-ledger-entries";
import { FileLink, FileMissingLabel, QuietAction, ICON } from "./emission-line-body-parts";
import { ENTRY_FILE_ACCEPT, entryDocumentType, type EmissionLine } from "./emission-line-display";

export type LineFile = NonNullable<EmissionLine["lineFile"]>;
type LineFileDocument = LineFile["documents"][number];

export const REPLACE_FILES_LABEL = "Replace files";
const documentHref = (document: LineFileDocument) => `/api/documents/${document.id}`;

/** What the row's slot and ⋯ menu share: the add panel, the two confirms and the menu items. */
export function useLineFileSlot(line: EmissionLine, lineFile: LineFile, scope: EmissionBatchScope, readOnly: boolean) {
  const toast = useToast();
  const remove = useRemoveEmissionLineFile(scope);
  const replace = useReplaceEmissionLineFiles(scope);
  const [addingFile, setAddingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<LineFileDocument | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const editable = !readOnly && !lineFile.locked;
  const startAddFile = () => { setUploadError(null); setAddingFile(true); };
  const stopAddFile = () => { setUploadError(null); setAddingFile(false); };

  // A file Isometric holds cannot be removed: in the correction window the set is replaced instead. Unsent files stay removable.
  const items: EntryMenuItem[] = !editable ? [] : [
    { label: "Add file", onSelect: () => startAddFile() },
    ...lineFile.documents.filter((document) => !document.sent).map((document) => ({
      label: `Remove ${document.fileName}`,
      destructive: true,
      onSelect: () => { setActionError(null); setRemoving(document); },
    })),
    ...(lineFile.canReplace ? [{ label: REPLACE_FILES_LABEL, onSelect: () => { setActionError(null); setReplacing(true); } }] : []),
  ];

  const confirmRemove = async () => {
    if (!removing) return;
    setActionError(null);
    try {
      await remove.mutateAsync({ documentId: removing.id, expectedVersion: removing.version });
      toast.success(`File removed from ${line.displayName}.`);
      setRemoving(null);
    } catch (caught) {
      setActionError(toSaveErrorMessage(caught, "The file was not removed. Try again."));
    }
  };

  const confirmReplace = async () => {
    if (!lineFile.anchorId || lineFile.version === null) return;
    setActionError(null);
    try {
      await replace.mutateAsync({ creditBatchId: scope.creditBatchId, componentId: line.componentId, anchorId: lineFile.anchorId, expectedVersion: lineFile.version });
      toast.success(`Files replaced on ${line.displayName}.`);
      setReplacing(false);
      // The next step is adding the new files, so the upload opens in place.
      startAddFile();
    } catch (caught) {
      setActionError(toSaveErrorMessage(caught, "The files were not replaced. Try again."));
    }
  };

  return {
    items, editable, addingFile, uploadError, setUploadError, actionError,
    startAddFile, stopAddFile,
    removing, replacing, removePending: remove.isPending, replacePending: replace.isPending,
    cancelRemove: () => setRemoving(null), cancelReplace: () => setReplacing(false),
    confirmRemove, confirmReplace,
  };
}

/** File names, or File missing with Add file, then the upload panel. */
export function LineFileEvidence({ line, lineFile, scope, slot, className }: {
  line: EmissionLine;
  lineFile: LineFile;
  scope: EmissionBatchScope;
  slot: ReturnType<typeof useLineFileSlot>;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const requestUpload = useEmissionLineFileUploadRequest(scope, line.componentId);
  const noFiles = lineFile.documents.length === 0;
  const missing = noFiles && lineFile.needsFile;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-x-16 gap-y-2 body-caption text-[var(--color-text-secondary)]">
        {missing && <FileMissingLabel />}
        {lineFile.documents.map((document) => <FileLink key={document.id} file={{ fileName: document.fileName, href: documentHref(document) }} />)}
        {noFiles && slot.editable && !slot.addingFile && (
          <QuietAction
            label={`Add file on ${line.displayName}`}
            icon={<PlusIcon size={ICON} weight="bold" aria-hidden="true" />}
            onClick={slot.startAddFile}
            className="min-h-24 body-caption"
          >
            Add file
          </QuietAction>
        )}
      </div>
      {slot.addingFile && slot.editable && (
        <div className="flex flex-col gap-8 pt-4">
          <FormFileUpload
            id={`line-file-${line.componentId}`}
            accept={ENTRY_FILE_ACCEPT}
            resolveDocumentType={entryDocumentType}
            requestUpload={requestUpload}
            // The panel stays open until Done: closing it per file would abort the rest of a multi-file queue.
            onUploaded={() => {
              slot.setUploadError(null);
              void invalidateEmissionEntryReads(queryClient, scope);
            }}
            // A refusal can mean the batch was claimed meanwhile; refresh so the slot shows the current lock.
            onUploadError={(error) => {
              slot.setUploadError(error);
              void invalidateEmissionEntryReads(queryClient, scope);
            }}
          />
          {slot.uploadError && <ServerError message={slot.uploadError} />}
          <div>
            <Button size="small" variant="weak" className={PHONE_TOUCH_TARGET} onClick={slot.stopAddFile}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The two confirms the ⋯ menu opens. */
export function LineFileDialogs({ line, lineFile, slot }: { line: EmissionLine; lineFile: LineFile; slot: ReturnType<typeof useLineFileSlot> }) {
  return (
    <>
      <DeleteConfirmDialog
        isOpen={!!slot.removing}
        title="Remove this file?"
        message={slot.removing ? `${slot.removing.fileName} is removed from ${line.displayName}. You can add it again.` : ""}
        confirmLabel="Remove"
        onConfirm={() => void slot.confirmRemove()}
        onCancel={slot.cancelRemove}
        isPending={slot.removePending}
        errorMessage={slot.actionError ?? undefined}
      />
      <ConfirmActionDialog
        isOpen={slot.replacing}
        title={`Replace the files on ${line.displayName}?`}
        body={`The files already sent to Isometric stay in history and are no longer sent.${lineFile.documents.some((document) => !document.sent) ? " Files not sent yet are removed." : ""} You add the new files next.`}
        confirmLabel={REPLACE_FILES_LABEL}
        onConfirm={() => void slot.confirmReplace()}
        onClose={slot.cancelReplace}
        isPending={slot.replacePending}
        errorMessage={slot.actionError ?? undefined}
      />
    </>
  );
}
