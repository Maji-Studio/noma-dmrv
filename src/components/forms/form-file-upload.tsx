/**
 * FormFileUpload component
 * Drag-and-drop file upload with optional real upload to documents storage.
 *
 * Three modes:
 *   - **Deferred**: holds parent-controlled real File objects until the parent
 *     entity exists. No network calls are made from this mode.
 *   - **Mockup** (default, backward-compatible): captures FileEntry[] locally
 *     and emits via onChange. No network calls. Used in legacy forms that
 *     haven't migrated to the documents storage layer yet.
 *   - **Real upload**: when `entityType`, `entityId`, and `documentType` are
 *     provided, files are PUT directly to storage via the useFileUpload hook
 *     and onUploaded is invoked with each documentId.
 */
"use client";

import { useRef, useState } from "react";
import { UploadSimpleIcon, FileIcon, XIcon, CheckCircleIcon, WarningCircleIcon, SpinnerIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { BYTES_PER_MB, formatFileSize } from "@/lib/format-utils";
import { useFileUpload } from "@/hooks/use-file-upload";
import type { DeferredFileEntry } from "@/hooks/use-deferred-attachments";
import type {
  ApplicationBoundaryLogbookEvidenceType,
  ApplicationVisualEvidenceRole,
} from "@/lib/certification/application-evidence";
import type { DocumentType } from "@/schemas/documents";

export type { DeferredFileEntry } from "@/hooks/use-deferred-attachments";

interface FileEntry {
  name: string;
  size: number;
  type: string;
}

interface UploadedEntry extends FileEntry {
  documentId: string;
  status: "uploading" | "uploaded" | "failed";
  progress?: number;
  error?: string;
  missingExif?: string[];
  tempKey: string;
}

interface FormFileUploadProps {
  id: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  error?: boolean;
  maxSizeMb?: number;
  helperText?: string;
  onChange?: (files: FileEntry[]) => void;
  entityType?: string;
  entityId?: string;
  documentType?: DocumentType;
  applicationEvidenceRole?: ApplicationVisualEvidenceRole;
  applicationLogbookEvidenceType?: ApplicationBoundaryLogbookEvidenceType;
  onUploaded?: (documentId: string) => void;
  onUploadError?: (error: string) => void;
  deferred?: boolean;
  deferredFiles?: DeferredFileEntry[];
  onDeferredAdd?: (files: File[]) => void;
  onDeferredRemove?: (key: string) => void;
}

function fileMatchesAccept(file: File, accept: string): boolean {
  const normalizedType = file.type.toLowerCase();
  const normalizedName = file.name.toLowerCase();

  return accept
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule.startsWith(".")) return normalizedName.endsWith(rule);
      if (rule.endsWith("/*")) {
        return normalizedType.startsWith(rule.slice(0, -1));
      }
      return normalizedType === rule;
    });
}

function getDropzoneClass(opts: {
  disabled: boolean;
  dragOver: boolean;
  error: boolean;
}): string {
  if (opts.disabled) {
    return "cursor-not-allowed opacity-50 border-[var(--color-border-tertiary)]";
  }
  if (opts.dragOver) {
    return "border-[var(--color-interaction)] bg-[var(--color-background-interaction-light)]";
  }
  if (opts.error) {
    return "border-[var(--color-signal-red)] hover:border-[var(--color-signal-red)]";
  }
  return "border-[var(--color-border-secondary)] hover:border-[var(--color-interaction)]";
}

export function FormFileUpload({
  id,
  accept = "image/*,.pdf,.csv,.xlsx",
  multiple = true,
  disabled = false,
  error = false,
  maxSizeMb = 10,
  onChange,
  entityType,
  entityId,
  documentType,
  applicationEvidenceRole,
  applicationLogbookEvidenceType,
  onUploaded,
  onUploadError,
  deferred = false,
  deferredFiles = [],
  onDeferredAdd,
  onDeferredRemove,
}: FormFileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [uploads, setUploads] = useState<UploadedEntry[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deferredError, setDeferredError] = useState<string | null>(null);
  const { upload } = useFileUpload();

  const isRealMode = !deferred && !!(entityType && entityId && documentType);

  function getMissingExif(metadata: Record<string, unknown>): string[] {
    const missingExif = metadata.missingExif;
    return Array.isArray(missingExif)
      ? missingExif.filter((item): item is string => typeof item === "string")
      : [];
  }

  async function startUpload(file: File) {
    const tempKey = crypto.randomUUID();
    setUploads((prev) => [
      ...prev,
      {
        name: file.name,
        size: file.size,
        type: file.type,
        documentId: "",
        status: "uploading",
        progress: 0,
        tempKey,
      },
    ]);
    try {
      const { documentId, metadata } = await upload({
        entityType: entityType!,
        entityId: entityId!,
        documentType: documentType!,
        file,
        applicationEvidenceRole,
        applicationLogbookEvidenceType,
        onProgress: (p) => {
          setUploads((prev) =>
            prev.map((u) =>
              u.tempKey === tempKey ? { ...u, progress: p } : u
            )
          );
        },
      });
      setUploads((prev) =>
        prev.map((u) =>
          u.tempKey === tempKey
            ? {
                ...u,
                status: "uploaded",
                documentId,
                progress: 1,
                missingExif: getMissingExif(metadata),
              }
            : u
        )
      );
      onUploaded?.(documentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploads((prev) =>
        prev.map((u) =>
          u.tempKey === tempKey ? { ...u, status: "failed", error: message } : u
        )
      );
      onUploadError?.(message);
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const arr = Array.from(fileList);

    if (deferred) {
      const queue = multiple ? arr : arr.slice(0, 1);
      const maxBytes = maxSizeMb * BYTES_PER_MB;
      const validationErrors: string[] = [];
      const acceptedFiles = queue.filter((file) => {
        if (file.size > maxBytes) {
          validationErrors.push(
            `${file.name} exceeds the ${maxSizeMb} MB limit.`,
          );
          return false;
        }
        if (!fileMatchesAccept(file, accept)) {
          validationErrors.push(`${file.name} is not an accepted file type.`);
          return false;
        }
        return true;
      });

      setDeferredError(
        validationErrors.length > 0 ? validationErrors.join(" ") : null,
      );
      if (acceptedFiles.length === 0) return;

      if (!multiple) {
        for (const entry of deferredFiles) onDeferredRemove?.(entry.key);
      }
      onDeferredAdd?.(acceptedFiles);
      return;
    }

    if (isRealMode) {
      const queue = multiple ? arr : arr.slice(0, 1);
      if (!multiple) setUploads([]);
      for (const f of queue) void startUpload(f);
      return;
    }

    const queue = multiple ? arr : arr.slice(0, 1);
    const entries: FileEntry[] = queue.map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type,
    }));
    const next = multiple ? [...files, ...entries] : entries;
    setFiles(next);
    onChange?.(next);
  }

  function removeMockup(index: number) {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    onChange?.(next);
  }

  function removeUpload(tempKey: string) {
    setUploads((prev) => prev.filter((u) => u.tempKey !== tempKey));
  }

  return (
    <div className="space-y-8">
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
        className={[
          "flex w-full flex-col items-center justify-center gap-8 border-2 border-dashed px-16 py-24 transition-colors duration-300",
          getDropzoneClass({
            disabled,
            dragOver: isDragOver,
            error: error || (deferred && !!deferredError),
          }),
        ].join(" ")}
      >
        <UploadSimpleIcon
          size={24}
          weight="bold"
          className={
            isDragOver
              ? "text-[var(--color-interaction)]"
              : "text-[var(--color-text-tertiary)]"
          }
        />
        <span className="body-small text-[var(--color-text-secondary)]">
          Drop files here or click to upload
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Max {maxSizeMb} MB per file
        </span>
      </button>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          handleFiles(e.target.files);
          if (deferred) e.target.value = "";
        }}
      />

      {deferred && deferredError && (
        <p
          role="alert"
          className="body-caption text-[var(--color-signal-red)]"
        >
          {deferredError}
        </p>
      )}

      {deferred && deferredFiles.length > 0 && (
        <ul className="space-y-4">
          {deferredFiles.map(({ key, file }) => (
            <li
              key={key}
              className="flex items-center gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
            >
              <FileIcon
                size={16}
                weight="bold"
                className="shrink-0 text-[var(--color-text-tertiary)]"
              />
              <span className="body-small truncate text-[var(--color-text-primary)]">
                {file.name}
              </span>
              <span className="body-caption shrink-0 text-[var(--color-text-tertiary)]">
                {formatFileSize(file.size)}
              </span>
              <Button
                type="button"
                variant="noOutline"
                size="icon"
                disabled={disabled}
                onClick={() => onDeferredRemove?.(key)}
                className="ml-auto h-24 w-24 shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-signal-red)]"
                aria-label={`Remove ${file.name}`}
              >
                <XIcon size={14} weight="bold" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {isRealMode && uploads.length > 0 && (
        <ul className="space-y-4">
          {uploads.map((u) => (
            <li
              key={u.tempKey}
              className="flex items-center gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
            >
              {u.status === "uploading" && (
                <SpinnerIcon
                  size={16}
                  weight="bold"
                  className="shrink-0 animate-spin text-[var(--color-text-tertiary)]"
                />
              )}
              {u.status === "uploaded" && (
                <CheckCircleIcon
                  size={16}
                  weight="fill"
                  className="shrink-0 text-[var(--color-signal-green)]"
                />
              )}
              {u.status === "failed" && (
                <WarningCircleIcon
                  size={16}
                  weight="fill"
                  className="shrink-0 text-[var(--color-signal-red)]"
                />
              )}
              <span className="body-small truncate text-[var(--color-text-primary)]">
                {u.name}
              </span>
              <span className="body-caption shrink-0 text-[var(--color-text-tertiary)]">
                {u.status === "uploading"
                  ? `${Math.round((u.progress ?? 0) * 100)}%`
                  : formatFileSize(u.size)}
              </span>
              {u.status === "failed" && u.error && (
                <span className="body-caption shrink-0 text-[var(--color-signal-red)]">
                  {u.error}
                </span>
              )}
              {u.status === "uploaded" &&
                u.missingExif &&
                u.missingExif.length > 0 && (
                  <span className="body-caption shrink-0 text-[var(--color-signal-orange-strong)]">
                    No geotag: {u.missingExif.join(", ")}
                  </span>
                )}
              <Button
                variant="noOutline"
                size="icon"
                onClick={() => removeUpload(u.tempKey)}
                className="ml-auto h-24 w-24 shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-signal-red)]"
                aria-label={`Remove ${u.name}`}
              >
                <XIcon size={14} weight="bold" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!deferred && !isRealMode && files.length > 0 && (
        <ul className="space-y-4">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
            >
              <FileIcon
                size={16}
                weight="bold"
                className="shrink-0 text-[var(--color-text-tertiary)]"
              />
              <span className="body-small truncate text-[var(--color-text-primary)]">
                {file.name}
              </span>
              <span className="body-caption shrink-0 text-[var(--color-text-tertiary)]">
                {formatFileSize(file.size)}
              </span>
              <Button
                variant="noOutline"
                size="icon"
                disabled={disabled}
                onClick={() => removeMockup(i)}
                className="ml-auto h-24 w-24 shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-signal-red)]"
                aria-label={`Remove ${file.name}`}
              >
                <XIcon size={14} weight="bold" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
