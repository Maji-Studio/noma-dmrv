/**
 * SourcesPanel — Phase 3.5
 *
 * Lists candidate noma documents discovered along the Removal's chain-of-
 * custody. Submission mirrors managed documents to Isometric Sources
 * automatically; each Source is then bound only to its code-owned intended
 * Datapoint target.
 *
 * Mounted in `RemovalDetailSheet` (the Removals-tab quick view, opened via
 * `?removal=<id>`), the single place the candidate set is consumed. The
 * earlier mounts — the credit-batch `CertifyPanel` and the standalone
 * `/certification/removals/[removalId]` detail page — were removed when the
 * 2026-06-04 certify redesign deleted `evidence-step.tsx`; the panel was
 * re-homed here so per-leg evidence can reach Isometric again.
 */
"use client";

import {
  CheckCircleIcon,
  CloudIcon,
  FileIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { useCandidateDocumentsForRemoval } from "@/hooks/use-certification-sources";
import { Section } from "./panel-layout";

const STATE_ICON_SIZE = 16;
const PDF_MIME_TYPE = "application/pdf";

interface SourcesPanelProps {
  // Null while the credit batch is not yet grouped into a removal — render
  // an inactive panel rather than fetching.
  removalId: string | null;
  isEditable: boolean;
}

export function SourcesPanel({ removalId, isEditable }: SourcesPanelProps) {
  return (
    <Section>
      <div className="flex flex-col gap-12">
        <header className="flex items-center justify-between gap-12">
          <h3 className="title-chapter-title">Registry value sources</h3>
          <PanelCounter removalId={removalId} isEditable={isEditable} />
        </header>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Files that support registry values are mirrored automatically when
          you submit. Application evidence stays with the Application.
        </p>
        <PanelBody removalId={removalId} isEditable={isEditable} />
      </div>
    </Section>
  );
}

function PanelCounter({
  removalId,
  isEditable,
}: {
  removalId: string | null;
  isEditable: boolean;
}) {
  const query = useCandidateDocumentsForRemoval(removalId);
  if (!removalId || !query.data) return null;
  const total = query.data.candidates.length;
  const ready = query.data.candidates.filter((c) => c.mirror).length;
  return (
    <span className="body-caption text-[var(--color-text-tertiary)]">
      {isEditable
        ? `${total} ${total === 1 ? "file" : "files"} linked`
        : `${ready} of ${total} ${total === 1 ? "file" : "files"} attached`}
    </span>
  );
}

function PanelBody({
  removalId,
  isEditable,
}: {
  removalId: string | null;
  isEditable: boolean;
}) {
  if (!removalId) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        A Removal will be created on first submit. Its supporting files will
        be mirrored automatically.
      </p>
    );
  }
  return (
    <PanelBodyForRemoval
      removalId={removalId}
      isEditable={isEditable}
    />
  );
}

function PanelBodyForRemoval({
  removalId,
  isEditable,
}: {
  removalId: string;
  isEditable: boolean;
}) {
  const query = useCandidateDocumentsForRemoval(removalId);

  if (query.isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Loading lineage documents…
      </p>
    );
  }
  if (query.isError || !query.data) {
    return (
      <p className="body-small text-[var(--clr-red)]">
        Registry value sources could not be loaded. Refresh the page and try
        again.
      </p>
    );
  }
  if (!query.data.hasMapping) {
    return (
      <p className="body-small text-[var(--color-text-secondary)]">
        Link this facility to an Isometric project in facility settings
        before submitting sources.
      </p>
    );
  }
  if (query.data.candidates.length === 0) {
    return (
      <EmptyState
        icon={<FileIcon size={32} />}
        title="No registry value sources found"
        description="GIS boundaries remain Application evidence and are not attached to mass or transport values. Add a logbook or bill of lading only when it supports one of those values."
        padding="sm"
      />
    );
  }

  return (
    <ul className="flex flex-col border border-[var(--color-border-secondary)]">
      {query.data.candidates.map((candidate, idx) => (
        <li
          key={candidate.document.id}
          className={
            idx > 0
              ? "border-t border-[var(--color-border-tertiary)]"
              : ""
          }
        >
          <CandidateRow
            candidate={candidate}
            isEditable={isEditable}
          />
        </li>
      ))}
    </ul>
  );
}

interface CandidateRowProps {
  isEditable: boolean;
  candidate: NonNullable<
    ReturnType<typeof useCandidateDocumentsForRemoval>["data"]
  >["candidates"][number];
}

function CandidateRow({
  candidate,
  isEditable,
}: CandidateRowProps) {
  const { document, lineageEntity, binding, mirror } = candidate;
  const isMirrored = !!mirror;
  const isMirrorable = !!document.storageKey;
  const isPdf = isPdfCandidate(document.mimeType, document.fileName);
  const description = [
    binding.nomaRoleLabel,
    lineageEntity.entityLabel,
  ].join(" · ");

  return (
    <div className="flex items-center justify-between gap-12 px-12 py-12">
      <div className="flex min-w-0 items-start gap-8">
        <FileIcon
          size={STATE_ICON_SIZE}
          weight="bold"
          className="mt-2 shrink-0 text-[var(--color-text-tertiary)]"
        />
        <div className="flex min-w-0 flex-col gap-2">
          {isPdf ? (
            <a
              href={`/api/documents/${encodeURIComponent(document.id)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="body-small truncate text-[var(--color-text-primary)] underline underline-offset-2 hover:text-[var(--color-interaction)]"
              title={`Preview ${document.fileName} in a new tab`}
            >
              {document.fileName}
            </a>
          ) : (
            <span className="body-small truncate text-[var(--color-text-primary)]">
              {document.fileName}
            </span>
          )}
          <span className="body-caption truncate text-[var(--color-text-tertiary)]">
            {description}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-8">
        {isMirrored ? (
          <span
            className="flex items-center gap-4 body-caption text-[var(--st-ok)]"
            title="Ready in Isometric"
          >
            <CheckCircleIcon size={STATE_ICON_SIZE} weight="fill" />
            Ready
          </span>
        ) : isMirrorable && isEditable ? (
          <span
            className="flex items-center gap-4 body-caption text-[var(--color-text-tertiary)]"
            role="status"
            title="This file is sent to Isometric automatically when you submit the Removal."
          >
            <CloudIcon size={STATE_ICON_SIZE} weight="bold" />
            On submit
          </span>
        ) : !isMirrorable ? (
          <span
            className="flex max-w-[180px] items-center gap-6 body-caption text-[var(--color-text-tertiary)]"
            role="status"
            title="Legacy URL-only document: noma has no managed file bytes to copy to Isometric. Upload a managed replacement before submitting."
          >
            <WarningCircleIcon
              size={STATE_ICON_SIZE}
              weight="bold"
              className="shrink-0"
            />
            No managed file bytes
          </span>
        ) : (
          <span
            className="body-caption text-[var(--color-text-tertiary)]"
            role="status"
          >
            Not mirrored
          </span>
        )}
      </div>
    </div>
  );
}

function isPdfCandidate(
  mimeType: string | null | undefined,
  fileName: string,
): boolean {
  const normalizedMime = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  return (
    normalizedMime === PDF_MIME_TYPE ||
    fileName.trim().toLowerCase().endsWith(".pdf")
  );
}
