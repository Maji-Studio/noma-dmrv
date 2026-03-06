/**
 * FormFileUpload component
 * Mockup file upload field with drop zone styling
 * Follows the design system's brutalist aesthetic (no border-radius)
 *
 * NOTE: This is a UI mockup. File upload infrastructure (S3, API routes)
 * is not yet implemented. The component captures selected files and
 * exposes them via onChange, but does not upload anywhere.
 */
"use client";

import { useRef, useState } from "react";
import { UploadSimple, File, X } from "@phosphor-icons/react/dist/ssr";

interface FileEntry {
  name: string;
  size: number;
  type: string;
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
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FormFileUpload({
  id,
  accept = "image/*,.pdf,.csv,.xlsx",
  multiple = true,
  disabled = false,
  error = false,
  maxSizeMb = 10,
  onChange,
}: FormFileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const entries: FileEntry[] = Array.from(fileList).map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type,
    }));
    const next = multiple ? [...files, ...entries] : entries;
    setFiles(next);
    onChange?.(next);
  }

  function removeFile(index: number) {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    onChange?.(next);
  }

  return (
    <div className="space-y-8">
      {/* Drop zone */}
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
          disabled
            ? "cursor-not-allowed opacity-50 border-[var(--color-border-tertiary)]"
            : isDragOver
              ? "border-[var(--color-interaction)] bg-[var(--color-background-interaction-light)]"
              : error
                ? "border-[var(--color-signal-red)] hover:border-[var(--color-signal-red)]"
                : "border-[var(--color-border-secondary)] hover:border-[var(--color-interaction)]",
        ].join(" ")}
      >
        <UploadSimple
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

      {/* Hidden native input */}
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* File list */}
      {files.length > 0 && (
        <ul className="space-y-4">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
            >
              <File
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
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeFile(i)}
                className="ml-auto shrink-0 p-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-signal-red)] transition-colors duration-300 disabled:opacity-50"
                aria-label={`Remove ${file.name}`}
              >
                <X size={14} weight="bold" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
