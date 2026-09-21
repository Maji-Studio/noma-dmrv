import {
  ArrowSquareOutIcon,
  FileIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui";
import type { DocumentRow } from "@/data-access/documents";
import {
  APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS,
  isApplicationVisualEvidenceRole,
} from "@/lib/certification/application-evidence";
import { formatDate, formatFileSize } from "@/lib/format-utils";

function metadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
export function ApplicationEvidenceDocumentList({
  docs,
  emptyMessage,
  disabled,
  deleteMutationPending,
  onDelete,
}: {
  docs: DocumentRow[];
  emptyMessage: string;
  disabled: boolean;
  deleteMutationPending: boolean;
  onDelete?: (id: string) => void;
}) {
  if (docs.length === 0) {
    return (
      <EmptyState
        icon={<FileIcon size={32} weight="bold" />}
        title={emptyMessage}
        padding="sm"
      />
    );
  }

  return (
    <ul className="flex flex-col gap-8">
      {docs.map((doc) => {
        const evidenceRoleValue = metadataRecord(doc.metadata).evidenceRole;
        const evidenceRole = isApplicationVisualEvidenceRole(evidenceRoleValue)
          ? evidenceRoleValue
          : null;
        const missingExifValue = metadataRecord(doc.metadata).missingExif;
        const missingExif =
          Array.isArray(missingExifValue) && missingExifValue.length > 0
            ? missingExifValue
                .filter((item) => typeof item === "string")
                .join(", ")
            : null;

        return (
          <li
            key={doc.id}
            className="flex flex-wrap items-center gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
          >
            <FileIcon
              size={16}
              weight="bold"
              className="shrink-0 text-[var(--color-text-tertiary)]"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="body-small truncate text-[var(--color-text-primary)]">
                {doc.fileName}
              </span>
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {formatFileSize(doc.fileSizeBytes)}
                {doc.capturedAt ? ` · ${formatDate(doc.capturedAt)}` : ""}
                {evidenceRole
                  ? ` · ${APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS[evidenceRole]}`
                  : ""}
              </span>
              {missingExif && (
                <span className="inline-flex items-center gap-4 body-caption text-[var(--color-signal-orange-strong)]">
                  <WarningCircleIcon size={14} weight="bold" />
                  Missing image metadata: {missingExif}
                </span>
              )}
            </div>
            <a
              href={`/api/documents/${doc.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-4 text-[var(--color-text-tertiary)] transition-colors duration-300 hover:text-[var(--color-interaction)]"
              aria-label={`Open ${doc.fileName}`}
            >
              <ArrowSquareOutIcon size={16} weight="bold" />
            </a>
            {onDelete && (
              <Button
                variant="destructive"
                size="icon"
                onClick={() => onDelete(doc.id)}
                disabled={deleteMutationPending || disabled}
                className="shrink-0"
                aria-label={`Delete ${doc.fileName}`}
              >
                <TrashIcon size={16} weight="bold" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
