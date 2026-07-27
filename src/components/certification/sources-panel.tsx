/**
 * SourcesPanel — Phase 3.5
 *
 * Lists candidate noma documents discovered along the Removal's chain-of-
 * custody. Review & submit prepares every missing Isometric Source as one
 * workflow operation; once prepared, `source_ids` ride into Datapoint payloads
 * and are hash-covered. This panel is status-only; evidence changes happen on
 * the owning entity before submit.
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
  // Derived by the owning Removal surface from the authoritative submission
  // state. Source rows stay visible after submit, but become status-only.
  editable: boolean;
}

export function SourcesPanel({ removalId, editable }: SourcesPanelProps) {
  return (
    <Section>
      <div className="flex flex-col gap-12">
        <header className="flex items-center justify-between gap-12">
          <h3 className="title-chapter-title">Supporting sources</h3>
          <PanelCounter removalId={removalId} />
        </header>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {editable
            ? "Supporting sources are prepared automatically during Review & submit. Replace or remove evidence from its owning record, not from this Removal."
            : "Source status is read-only. Evidence must be replaced or removed from its owning record before submission."}
        </p>
        <PanelBody removalId={removalId} editable={editable} />
      </div>
    </Section>
  );
}

function PanelCounter({ removalId }: { removalId: string | null }) {
  const query = useCandidateDocumentsForRemoval(removalId);
  if (!removalId || !query.data) return null;
  const total = query.data.candidates.length;
  const mirrored = query.data.candidates.filter((c) => c.mirror).length;
  return (
    <span className="body-caption text-[var(--color-text-tertiary)]">
      {mirrored} of {total} ready
    </span>
  );
}

function PanelBody({
  removalId,
  editable,
}: {
  removalId: string | null;
  editable: boolean;
}) {
  if (!removalId) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        A removal will be created on first submit. You can mirror sources
        from the Removals hub once it exists.
      </p>
    );
  }
  return <PanelBodyForRemoval removalId={removalId} editable={editable} />;
}

function PanelBodyForRemoval({
  removalId,
  editable,
}: {
  removalId: string;
  editable: boolean;
}) {
  const query = useCandidateDocumentsForRemoval(removalId);

  if (query.isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Loading lineage documents…
      </p>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="body-small text-[var(--clr-red)]">
        Unable to load supporting sources. Try refreshing.
      </p>
    );
  }
  if (!query.data.hasMapping) {
    return (
      <p className="body-small text-[var(--color-text-secondary)]">
        Link this facility to an Isometric project in facility settings
        before mirroring sources.
      </p>
    );
  }
  if (query.data.candidates.length === 0) {
    return (
      <EmptyState
        icon={<FileIcon size={32} />}
        title="No supporting documents found"
        description="Attach lab reports, weighbridge tickets, BoLs, or PDDs to the entities in this Removal's chain to make them available here."
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
            editable={editable}
          />
        </li>
      ))}
    </ul>
  );
}

interface CandidateRowProps {
  editable: boolean;
  candidate: NonNullable<
    ReturnType<typeof useCandidateDocumentsForRemoval>["data"]
  >["candidates"][number];
}

function CandidateRow({ candidate, editable }: CandidateRowProps) {
  const { document, lineageEntity, mirror } = candidate;
  const isMirrored = !!mirror;
  const isMirrorable = !!document.storageKey;
  const isPdf = isPdfCandidate(document.mimeType, document.fileName);

  const description = [
    document.documentType.replace(/_/g, " "),
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
          {isMirrored && mirror && (
            <span className="body-caption font-mono text-[var(--color-text-tertiary)] truncate">
              {mirror.externalDocumentId}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-8">
        {isMirrored ? (
          <span
            className="flex items-center gap-4 text-[var(--st-ok)]"
            title="Mirrored to Isometric"
            role="status"
          >
            <CheckCircleIcon size={STATE_ICON_SIZE} weight="fill" />
          </span>
        ) : isMirrorable && editable ? (
          <span
            className="body-caption text-[var(--color-text-tertiary)]"
            role="status"
          >
            Pending preparation
          </span>
        ) : isMirrorable ? (
          <span
            className="body-caption text-[var(--color-text-tertiary)]"
            role="status"
          >
            Not mirrored
          </span>
        ) : (
          <span
            className="flex max-w-[180px] items-center gap-6 body-caption text-[var(--color-text-tertiary)]"
            role="status"
            title="Legacy URL-only document: noma has no managed file bytes to copy to Isometric. Upload a new managed document to mirror it."
          >
            <WarningCircleIcon
              size={STATE_ICON_SIZE}
              weight="bold"
              className="shrink-0"
            />
            No managed file bytes
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
