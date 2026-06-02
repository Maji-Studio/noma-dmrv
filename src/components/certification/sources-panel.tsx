/**
 * SourcesPanel — Phase 3.5
 *
 * Lists candidate noma documents discovered along the Removal's chain-of-
 * custody. The operator mirrors selected docs to Isometric Sources via a
 * server-side proxy; once mirrored, `source_ids` ride into Datapoint payloads
 * at submit time and are hash-covered (a sources change supersedes the
 * Removal version).
 *
 * Mounted in two places:
 *  - The credit-batch side-sheet's `CertifyPanel`
 *  - The standalone `/certification/removals/[removalId]` detail page
 */
"use client";

import { useEffect, useState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  Cloud,
  File as FileIcon,
  Lock,
  Globe,
} from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  useCandidateDocumentsForRemoval,
  useMirrorDocumentToSource,
  useSetDocumentSourceVisibility,
  useUnlinkDocumentSource,
} from "@/hooks/use-certification-sources";
import { Section } from "./panel-layout";

const ICON_SIZE = 14;
const STATE_ICON_SIZE = 16;

interface SourcesPanelProps {
  // Null while the credit batch is not yet grouped into a removal — render
  // an inactive panel rather than fetching.
  removalId: string | null;
}

export function SourcesPanel({ removalId }: SourcesPanelProps) {
  return (
    <Section>
      <div className="flex flex-col gap-12">
        <header className="flex items-center justify-between gap-12">
          <h3 className="title-chapter-title">Supporting sources</h3>
          <PanelCounter removalId={removalId} />
        </header>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Documents you mirror here attach to every Datapoint in this
          Removal. Mirror once per document — re-submitting the Removal
          with a different set of sources creates a new version.
        </p>
        <PanelBody removalId={removalId} />
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
      {mirrored} of {total} mirrored
    </span>
  );
}

function PanelBody({ removalId }: { removalId: string | null }) {
  if (!removalId) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        A removal will be created on first submit. You can mirror sources
        from the Removals hub once it exists.
      </p>
    );
  }
  return <PanelBodyForRemoval removalId={removalId} />;
}

function PanelBodyForRemoval({ removalId }: { removalId: string }) {
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
          <CandidateRow removalId={removalId} candidate={candidate} />
        </li>
      ))}
    </ul>
  );
}

interface CandidateRowProps {
  removalId: string;
  candidate: NonNullable<
    ReturnType<typeof useCandidateDocumentsForRemoval>["data"]
  >["candidates"][number];
}

function CandidateRow({ removalId, candidate }: CandidateRowProps) {
  const { document, lineageEntity, mirror } = candidate;
  const isMirrored = !!mirror;
  const remoteIsPublic = mirror?.isPublic ?? false;
  const [isPublic, setIsPublic] = useState(remoteIsPublic);
  // Sync local toggle when the candidate query refetches with a different
  // remote value — e.g., another operator flipped visibility from another
  // tab and our window refocused. Without this, the toggle would show the
  // stale local value while the server has the new one.
  useEffect(() => {
    setIsPublic(remoteIsPublic);
  }, [remoteIsPublic]);
  const mirrorMutation = useMirrorDocumentToSource();
  const unlinkMutation = useUnlinkDocumentSource(removalId);
  const visibilityMutation = useSetDocumentSourceVisibility(removalId);
  const toast = useToast();

  const pending =
    mirrorMutation.isPending ||
    unlinkMutation.isPending ||
    visibilityMutation.isPending;

  const description = [
    document.documentType.replace(/_/g, " "),
    lineageEntity.entityLabel,
  ].join(" · ");

  const handleMirror = () => {
    mirrorMutation.mutate(
      { removalId, documentId: document.id, isPublic },
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
      },
    );
  };

  const handleUnlink = () => {
    unlinkMutation.mutate(
      { documentId: document.id },
      {
        onSuccess: (result) => {
          if (result.unlinked) {
            toast.success("Unlinked. The Source remains on Isometric.");
          }
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Unlink failed."),
      },
    );
  };

  const handleVisibilityToggle = () => {
    const next = !isPublic;
    setIsPublic(next);
    if (!isMirrored) return; // pre-mirror: just stage the choice
    visibilityMutation.mutate(
      { documentId: document.id, isPublic: next },
      {
        onSuccess: () =>
          toast.success(
            next
              ? "Source set to public on the registry."
              : "Source set to private.",
          ),
        onError: (err) => {
          setIsPublic(!next); // revert UI on failure
          toast.error(
            err instanceof Error ? err.message : "Visibility change failed.",
          );
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
          <span className="body-small truncate text-[var(--color-text-primary)]">
            {document.fileName}
          </span>
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
        <button
          type="button"
          aria-pressed={isPublic}
          aria-label={
            isPublic
              ? "Public on registry — click to set private"
              : "Private — click to set public"
          }
          onClick={handleVisibilityToggle}
          disabled={pending}
          title={
            isPublic
              ? "Public on the registry after issuance"
              : "Private — only visible to the verifier"
          }
          className="flex items-center gap-4 border border-[var(--color-border-secondary)] px-8 py-4 transition-colors hover:border-[var(--color-border-primary)] disabled:opacity-50"
        >
          {isPublic ? (
            <>
              <Globe size={ICON_SIZE} weight="bold" />
              <span className="body-caption">Public</span>
            </>
          ) : (
            <>
              <Lock size={ICON_SIZE} weight="bold" />
              <span className="body-caption">Private</span>
            </>
          )}
        </button>

        {isMirrored ? (
          <>
            <span
              className="flex items-center gap-4 text-[var(--color-signal-green)]"
              title="Mirrored to Isometric"
            >
              <CheckCircle size={STATE_ICON_SIZE} weight="fill" />
            </span>
            <Button
              variant="default"
              size="small"
              onClick={handleUnlink}
              disabled={pending}
            >
              Unlink
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="small"
            onClick={handleMirror}
            disabled={pending}
          >
            {mirrorMutation.isPending ? (
              <ArrowsClockwise
                size={ICON_SIZE}
                className="animate-spin"
              />
            ) : (
              <Cloud size={ICON_SIZE} weight="bold" />
            )}
            Mirror
          </Button>
        )}
      </div>
    </div>
  );
}
