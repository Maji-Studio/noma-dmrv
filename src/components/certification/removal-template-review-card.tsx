/**
 * One Removal template in the line review: its name and whether it is the
 * facility default, what changed since the last read, whether Isometric
 * returned it in full, and every line grouped as the template groups them.
 *
 * Owners and Admins collect line assignments as a local draft and save them
 * together against the observation and version the first draft was made on.
 * A refetch never moves that baseline under the draft (#768): a stale save
 * keeps the draft and shows the conflict, and only "Discard changes and reload"
 * drops both and reads the templates again.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { FormActions } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { useReviewRemovalTemplateLines } from "@/hooks/use-removal-template-review";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { getStaleVersionConflict, toSaveErrorMessage } from "@/lib/stale-version";
import { RawIdentifiers } from "./removal-template-mapping-view";
import { RemovalTemplateLineRow } from "./removal-template-line-row";
import {
  changeSummary,
  DEPRECATED_FACTORS_LABEL,
  deprecatedFactorCount,
  groupLines,
  isNotFullyRead,
  lineNeedsReview,
  problemMessages,
  reviewCountSummary,
  TEMPLATE_NOT_FULLY_READ_TITLE,
  templateName,
  type LineAssignment,
  type RemovalTemplateReviewEntry,
} from "./removal-template-review-model";

export interface RemovalTemplateReviewCardProps {
  entry: RemovalTemplateReviewEntry;
  facilityId: string;
  canManage: boolean;
  /** Reads the templates again from Isometric. */
  onRetry: () => void;
  isRetrying: boolean;
}

function DeprecationFact({ entry }: { entry: RemovalTemplateReviewEntry }) {
  const count = deprecatedFactorCount(entry);
  if (count) {
    return (
      <Notice tone="warning">
        {`${count} fixed ${count === 1 ? "factor is" : "factors are"} deprecated in Isometric. Removals can still be submitted; Isometric replaces the factor.`}
      </Notice>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="body-caption text-[var(--color-text-tertiary)]">{DEPRECATED_FACTORS_LABEL}</span>
      <span className="body-small text-[var(--color-text-tertiary)]">
        {count === 0 ? MISSING_VALUE.none : `${MISSING_VALUE.notAvailable}. Isometric does not report deprecated factors.`}
      </span>
    </div>
  );
}

/** The observation a draft was made on; every save of that draft is checked against it. */
interface DraftBaseline {
  observationId: string;
  version: number;
}

export function RemovalTemplateReviewCard({
  entry,
  facilityId,
  canManage,
  onRetry,
  isRetrying,
}: RemovalTemplateReviewCardProps) {
  const [drafts, setDrafts] = useState<Record<string, LineAssignment>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [baseline, setBaseline] = useState<DraftBaseline>();
  const [stale, setStale] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const review = useReviewRemovalTemplateLines();
  const toast = useToast();

  const name = templateName(entry);
  const notFullyRead = isNotFullyRead(entry);
  const missing = entry.availability === "missing";
  const lineIds = new Set(entry.lines.map((line) => line.component.id));
  // A reload after a stale save can drop a line; never send a draft for it.
  const pending = Object.fromEntries(Object.entries(drafts).filter(([id]) => lineIds.has(id)));
  const pendingCount = Object.keys(pending).length;
  const reviewCount = entry.lines.filter((line) => lineNeedsReview(line, entry.lineSourceProblems)).length;
  const unreadLines = new Set(entry.enrichmentProblems.map((problem) => problem.componentId));
  const hasEarlierRead = Object.keys(entry.changes).length > 0;
  const headingId = `removal-template-${entry.templateId}`;

  const resetDrafts = () => {
    setDrafts({});
    setEditing({});
    setBaseline(undefined);
    setStale(false);
    setSaveError(undefined);
  };

  const setDraft = (componentId: string, draft: LineAssignment | undefined) => {
    const next = { ...drafts };
    if (draft) next[componentId] = draft;
    else delete next[componentId];
    if (Object.keys(next).length === 0) {
      // Nothing left to save, so nothing left to check: the next draft starts fresh.
      setDrafts({});
      setBaseline(undefined);
      setStale(false);
      setSaveError(undefined);
      return;
    }
    if (!stale) setSaveError(undefined);
    setDrafts(next);
    if (!baseline && entry.observation) {
      setBaseline({ observationId: entry.observation.id, version: entry.observation.version });
    }
  };

  const save = async () => {
    if (!baseline || pendingCount === 0) return;
    setSaveError(undefined);
    try {
      await review.mutateAsync({
        observationId: baseline.observationId,
        expectedVersion: baseline.version,
        assignments: pending,
      });
      resetDrafts();
      toast.success(`Template lines saved for ${name}.`);
    } catch (error) {
      setSaveError(toSaveErrorMessage(error, "The template lines were not saved. Try again."));
      if (getStaleVersionConflict(error)) setStale(true);
    }
  };

  const reload = () => {
    resetDrafts();
    onRetry();
  };

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--paper)]"
    >
      <header className="flex flex-wrap items-start justify-between gap-12 border-b border-[var(--color-border-tertiary)] px-20 py-16">
        <div className="flex min-w-0 flex-col gap-4">
          <h3 id={headingId} className="body-medium font-medium text-[var(--color-text-primary)]">
            {name}
          </h3>
          {!missing && (
            <p className="body-caption text-[var(--color-text-tertiary)]">
              {reviewCountSummary(entry.lines.length, reviewCount)} {changeSummary(entry.changes)}
            </p>
          )}
        </div>
        {entry.isDefault && <StatusBadge status="active" label="Default" size="small" className="shrink-0" />}
      </header>

      <div className="flex flex-col gap-16 px-20 py-16">
        {missing ? (
          <Notice
            tone="warning"
            title="Template no longer exists in Isometric."
            action={
              <Link
                href={`/credit-batches?${new URLSearchParams({ facility: facilityId })}`}
                className="body-small underline underline-offset-2"
              >
                Open credit batches
              </Link>
            }
          >
            Switch the credit batches that use it to another Removal template.
          </Notice>
        ) : (
          <>
            {notFullyRead && (
              <Notice
                tone="warning"
                title={TEMPLATE_NOT_FULLY_READ_TITLE}
                action={
                  <Button size="small" variant="weak" busy={isRetrying} onClick={onRetry}>
                    Retry
                  </Button>
                }
              >
                Isometric did not return every unit or factor. Saving is off until a retry reads the template in full.
              </Notice>
            )}
            {!canManage && reviewCount > 0 && (
              <Notice tone="info">
                Ask an Owner or Admin to review the lines marked Needs review.
              </Notice>
            )}
            <DeprecationFact entry={entry} />

            {groupLines(entry.lines).map((group) => (
              <section key={group.key} className="flex flex-col gap-8" aria-label={group.name}>
                <h4 className="body-small font-medium text-[var(--color-text-secondary)]">{group.name}</h4>
                <ul className="flex flex-col divide-y divide-[var(--color-border-tertiary)] border-y border-[var(--color-border-tertiary)]">
                  {group.lines.map((line) => {
                    const id = line.component.id;
                    return (
                      <RemovalTemplateLineRow
                        key={id}
                        line={line}
                        idPrefix={`${entry.templateId}-${id}`}
                        needsReview={lineNeedsReview(line, entry.lineSourceProblems)}
                        problems={problemMessages(line, entry.lineSourceProblems)}
                        // With no observation every line is unread; the template notice says so once.
                        notFullyRead={!!entry.observation && unreadLines.has(id)}
                        enrichment={entry.observation?.enrichment[id]}
                        showChange={hasEarlierRead}
                        // Without a read there is no observation to save against.
                        canManage={canManage && !!entry.observation}
                        draft={pending[id]}
                        editing={!!editing[id]}
                        onDraftChange={(draft) => setDraft(id, draft)}
                        onEditingChange={(open) => setEditing((current) => ({ ...current, [id]: open }))}
                      />
                    );
                  })}
                </ul>
              </section>
            ))}

            {canManage && (
              <FormActions
                sticky={false}
                submitType="button"
                onSubmitClick={() => void save()}
                submitVariant="default"
                submitLabel={pendingCount > 1 ? `Save ${pendingCount} lines` : "Save line"}
                submittingLabel="Saving…"
                isSubmitting={review.isPending}
                submitDisabled={pendingCount === 0 || notFullyRead || !baseline || stale}
                errorMessage={saveError}
                errorAction={stale ? (
                  <Button size="small" variant="weak" busy={isRetrying} onClick={reload}>
                    Discard changes and reload
                  </Button>
                ) : undefined}
              />
            )}
          </>
        )}

        <RawIdentifiers
          summary="Technical details"
          entries={[
            ["Template", entry.templateId],
            ...(entry.observation
              ? [["Read", entry.observation.id], ["Version", String(entry.observation.version)]] as Array<[string, string]>
              : []),
          ]}
        />
      </div>
    </article>
  );
}
