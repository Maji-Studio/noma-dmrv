/**
 * The files of one manual entry: their names (each opens the file), and the
 * Add file upload, which goes straight to document storage for entity type
 * `emission_entry`.
 */
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FileIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { FormFileUpload } from "@/components/forms/form-file-upload";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useDocumentsForEntity } from "@/hooks/use-documents";
import { invalidateEmissionEntryReads, type EmissionBatchScope } from "@/hooks/use-emission-entries";
import { ENTRY_FILE_ACCEPT, entryDocumentType, type EmissionEntry } from "./emission-line-display";

export const ENTRY_ENTITY_TYPE = "emission_entry";
const FILE_NAME_SKELETON = "h-16 w-[160px]";

/** File names of an entry, or "File missing" when it has none. */
export function EntryFileNames({ entry }: { entry: EmissionEntry }) {
  const hasFiles = entry.documentCount > 0;
  const { data: documents, isLoading } = useDocumentsForEntity(ENTRY_ENTITY_TYPE, entry.id, { enabled: hasFiles });
  if (!hasFiles) {
    return (
      <span className="inline-flex items-center gap-4 body-caption text-[var(--st-wait)]">
        <WarningIcon size={14} weight="bold" aria-hidden="true" />
        File missing
      </span>
    );
  }
  if (isLoading) return <Skeleton className={FILE_NAME_SKELETON} />;
  const uploaded = (documents ?? []).filter((document) => document.uploadStatus === "uploaded");
  return (
    <ul className="flex flex-col gap-2">
      {uploaded.map((document) => (
        <li key={document.id} className="min-w-0">
          <a
            href={`/api/documents/${document.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-24 max-w-full items-center gap-4 body-caption text-[var(--color-text-secondary)] underline-offset-4 hover:text-[var(--color-text-primary)] hover:underline"
          >
            <FileIcon size={14} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{document.fileName}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

interface EntryFileUploadProps {
  id: string;
  entry: EmissionEntry;
  scope: EmissionBatchScope;
  onUploaded?: () => void;
  onError?: (message: string) => void;
}

/** Uploads files to an existing entry. Saved immediately. */
export function EntryFileUpload({ id, entry, scope, onUploaded, onError }: EntryFileUploadProps) {
  const queryClient = useQueryClient();
  return (
    <FormFileUpload
      id={id}
      accept={ENTRY_FILE_ACCEPT}
      entityType={ENTRY_ENTITY_TYPE}
      entityId={entry.id}
      resolveDocumentType={entryDocumentType}
      onUploaded={() => {
        void invalidateEmissionEntryReads(queryClient, scope);
        onUploaded?.();
      }}
      onUploadError={onError}
    />
  );
}
