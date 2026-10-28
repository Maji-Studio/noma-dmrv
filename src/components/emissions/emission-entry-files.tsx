/**
 * The files of one manual entry: their names (each opens the file), and the
 * Add file upload, which goes straight to document storage for entity type
 * `emission_entry`.
 */
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FileIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { FormFileUpload } from "@/components/forms/form-file-upload";
import { useDocumentsForEntity } from "@/hooks/use-documents";
import { pluralize } from "@/lib/copy-utils";
import { invalidateEmissionEntryReads, type EmissionBatchScope } from "@/hooks/use-emission-entries";
import { ENTRY_FILE_ACCEPT, entryDocumentType, type EmissionEntry } from "./emission-line-display";

export const ENTRY_ENTITY_TYPE = "emission_entry";

export interface EntryFile { id: string; fileName: string; href: string }

/**
 * The uploaded files of an entry. The names load on demand; until they do
 * (or when the read fails) the entry's own document count stands in, so the
 * slot never shows an empty placeholder bar.
 */
export function useEntryFiles(entry: EmissionEntry): { files: EntryFile[] | null; countText: string } {
  const { data: documents } = useDocumentsForEntity(ENTRY_ENTITY_TYPE, entry.id, { enabled: entry.documentCount > 0 });
  const files = documents
    ? documents
        .filter((document) => document.uploadStatus === "uploaded")
        .map((document) => ({ id: document.id, fileName: document.fileName, href: `/api/documents/${document.id}` }))
    : null;
  return { files, countText: pluralize(entry.documentCount, "1 file", `${entry.documentCount} files`) };
}

/** File names of an entry, or "File missing" when it has none. */
export function EntryFileNames({ entry }: { entry: EmissionEntry }) {
  const { files, countText } = useEntryFiles(entry);
  if (entry.documentCount === 0) {
    return (
      <span className="inline-flex items-center gap-4 body-caption text-[var(--st-wait)]">
        <WarningIcon size={14} weight="bold" aria-hidden="true" />
        File missing
      </span>
    );
  }
  if (!files) {
    return (
      <span className="inline-flex min-h-24 items-center gap-4 body-caption text-[var(--color-text-tertiary)]">
        <FileIcon size={14} aria-hidden="true" className="shrink-0" />
        {countText}
      </span>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {files.map((file) => (
        <li key={file.id} className="min-w-0">
          <a
            href={file.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-24 max-w-full items-center gap-4 body-caption text-[var(--color-text-secondary)] underline-offset-4 hover:text-[var(--color-text-primary)] hover:underline"
          >
            <FileIcon size={14} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{file.fileName}</span>
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
