/**
 * SourcesPanel — Phase 3.5
 *
 * Lists candidate noma documents discovered along the Removal's chain-of-
 * custody. The operator mirrors selected docs to Isometric Sources via a
 * server-side proxy; once ready, each Source is bound only to its code-owned
 * intended Datapoint target at submit time.
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
import { useRef } from "react";
import { Button, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  useCandidateDocumentsForRemoval,
  useMirrorDocumentToSource,
} from "@/hooks/use-certification-sources";
import { Section } from "./panel-layout";

const ICON_SIZE = 14;
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
          <h3 className="title-chapter-title">Supporting sources</h3>
          <PanelCounter removalId={removalId} />
        </header>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Prepare each Noma evidence role for its intended Removal datapoint.
          Attachment is verified separately after submission.
        </p>
        <PanelBody removalId={removalId} isEditable={isEditable} />
      </div>
    </Section>
  );
}

function PanelCounter({ removalId }: { removalId: string | null }) {
  const query = useCandidateDocumentsForRemoval(removalId);
  if (!removalId || !query.data) return null;
  const total = query.data.candidates.length;
  const ready = query.data.candidates.filter((c) => c.mirror).length;
  return (
    <span className="body-caption text-[var(--color-text-tertiary)]">
      {ready} of {total} files ready
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
        A removal will be created on first submit. You can mirror sources
        from the Removals hub once it exists.
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
        title="No mapped evidence files found"
        description="Add an Inventory application document, feedstock bill of lading, or delivery bill of lading to this Removal's lineage."
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
            removalId={removalId}
            candidate={candidate}
            isEditable={isEditable}
          />
        </li>
      ))}
    </ul>
  );
}

interface CandidateRowProps {
  removalId: string;
  isEditable: boolean;
  candidate: NonNullable<
    ReturnType<typeof useCandidateDocumentsForRemoval>["data"]
  >["candidates"][number];
}

export type SourceRowState = "idle" | "pending" | "success" | "failure";

export function deriveSourceRowState(args: {
  hasConfirmedMapping: boolean;
  isPending: boolean;
  isError: boolean;
}): SourceRowState {
  if (args.hasConfirmedMapping) return "success";
  if (args.isPending) return "pending";
  if (args.isError) return "failure";
  return "idle";
}

export function canStartSourceMirror(state: SourceRowState): boolean {
  return state === "idle" || state === "failure";
}

function CandidateRow({
  removalId,
  candidate,
  isEditable,
}: CandidateRowProps) {
  const { document, lineageEntity, binding, mirror } = candidate;
  const isMirrored = !!mirror;
  const isMirrorable = !!document.storageKey;
  const isPdf = isPdfCandidate(document.mimeType, document.fileName);
  const mirrorMutation = useMirrorDocumentToSource();
  const toast = useToast();
  const mirrorActionInFlight = useRef(false);

  const rowState = deriveSourceRowState({
    hasConfirmedMapping: isMirrored,
    isPending: mirrorMutation.isPending,
    isError: mirrorMutation.isError,
  });
  const description = [
    `Noma role: ${binding.nomaRoleLabel}`,
    lineageEntity.entityLabel,
  ].join(" · ");

  const handleMirror = () => {
    if (
      mirrorActionInFlight.current ||
      !canStartSourceMirror(rowState)
    ) {
      return;
    }
    mirrorActionInFlight.current = true;
    mirrorMutation.mutate(
      { removalId, documentId: document.id },
      {
        onSuccess: (result) => {
          if (result.recovered) {
            toast.success(
              `Reconciled existing Isometric Source for ${document.fileName}.`,
            );
          } else {
            toast.success(`Mirrored ${document.fileName} to Isometric.`);
          }
        },
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Mirror failed.",
          ),
        onSettled: () => {
          mirrorActionInFlight.current = false;
        },
      },
    );
  };

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
        {rowState === "success" ? (
          <span
            className="flex items-center gap-4 text-[var(--st-ok)]"
            title="Mirrored to Isometric"
          >
            <CheckCircleIcon size={STATE_ICON_SIZE} weight="fill" />
          </span>
        ) : isMirrorable && isEditable ? (
          <Button
            variant="primary"
            size="small"
            onClick={handleMirror}
            disabled={rowState === "pending"}
            busy={rowState === "pending"}
          >
            {rowState !== "pending" && (
              <CloudIcon size={ICON_SIZE} weight="bold" />
            )}
            {rowState === "pending"
              ? "Pending"
              : rowState === "failure"
                ? "Retry"
                : "Mirror"}
          </Button>
        ) : !isMirrorable ? (
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
