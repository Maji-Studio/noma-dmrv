/**
 * One Removal template in Removal templates: its name, whether it is the
 * facility default (an Owner or Admin makes another one the default here),
 * what changed since the last read, whether Isometric returned it in full, and
 * every line laid out like Isometric's template page (Mitigated and Emitted,
 * groups with counts) with noma's decision per line.
 *
 * A template no default or credit batch uses is shown from a live read and
 * stores nothing until an Owner or Admin starts deciding its lines.
 *
 * Owners and Admins collect line assignments as a React Hook Form draft keyed
 * by component id, so the dialog and sheet unsaved-changes guards see it, and
 * save them together against the observation and version the first draft was
 * made on.
 * A refetch never moves that baseline under the draft (#768): a stale save
 * keeps the draft and shows the conflict, and only "Discard changes and reload"
 * drops both and reads the templates again.
 */
"use client";

import { useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useController, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormActions } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { useReviewRemovalTemplateLines, useSetFacilityDefaultRemovalTemplate, useStartRemovalTemplateSetup } from "@/hooks/use-removal-template-review";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { DECIDE_LINES_LINK_LABEL } from "@/lib/certification/links";
import { getStaleVersionConflict, toSaveErrorMessage } from "@/lib/stale-version";
import {
  reviewRemovalTemplateLinesFormSchema,
  type ReviewRemovalTemplateLinesFormValues,
} from "@/schemas/removal-template-review";
import { RawIdentifiers } from "./removal-template-mapping-view";
import { RemovalTemplateLineRow } from "./removal-template-line-row";
import { RemovalTemplateLineSections } from "./removal-template-line-sections";
import {
  canAcceptProposal,
  changeSummary,
  DEPRECATED_FACTORS_LABEL,
  deprecatedFactorCount,
  isNotFullyRead,
  lineNeedsReview,
  NOT_SET_UP_TITLE,
  problemMessages,
  reviewCountSummary,
  linesToDecideCount,
  TEMPLATE_NOT_FULLY_READ_TITLE,
  TO_DECIDE_LABEL,
  templateName,
  type LineAssignment,
  type RemovalTemplateReviewEntry,
} from "./removal-template-review-model";

const SET_UP_TEMPLATE_LABEL = "Set up template";

export interface RemovalTemplateReviewCardProps {
  entry: RemovalTemplateReviewEntry;
  facilityId: string;
  canManage: boolean;
  /** Reads the templates again from Isometric. */
  onRetry: () => void;
  isRetrying: boolean;
  /** Open on first render: the default, or the template a link asked for. */
  defaultExpanded: boolean;
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

const EMPTY_DRAFT: ReviewRemovalTemplateLinesFormValues = { assignments: {} };
const INVALID_DRAFT_MESSAGE = "Some line assignments are not valid. Change them and save again.";

export function RemovalTemplateReviewCard({
  entry,
  facilityId,
  canManage,
  onRetry,
  isRetrying,
  defaultExpanded,
}: RemovalTemplateReviewCardProps) {
  const {
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<ReviewRemovalTemplateLinesFormValues>({
    resolver: zodResolver(reviewRemovalTemplateLinesFormSchema),
    defaultValues: EMPTY_DRAFT,
  });
  const { field } = useController({ control, name: "assignments" });
  const drafts = field.value;
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [baseline, setBaseline] = useState<DraftBaseline>();
  const [stale, setStale] = useState(false);
  const review = useReviewRemovalTemplateLines();
  const setDefault = useSetFacilityDefaultRemovalTemplate();
  const startSetup = useStartRemovalTemplateSetup();
  const toast = useToast();
  const [expandedByToggle, setExpanded] = useState(defaultExpanded);

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
    reset(EMPTY_DRAFT);
    setEditing({});
    setBaseline(undefined);
    setStale(false);
  };

  const setDraft = (componentId: string, draft: LineAssignment | undefined) => {
    const next = { ...drafts };
    if (draft) next[componentId] = draft;
    else delete next[componentId];
    if (Object.keys(next).length === 0) {
      // Nothing left to save, so nothing left to check: the next draft starts fresh.
      reset(EMPTY_DRAFT);
      setBaseline(undefined);
      setStale(false);
      return;
    }
    // A stale refusal stays until the draft is discarded and reloaded.
    if (!stale) clearErrors();
    field.onChange(next);
    if (!baseline && entry.observation) {
      setBaseline({ observationId: entry.observation.id, version: entry.observation.version });
    }
  };

  const save = async (values: ReviewRemovalTemplateLinesFormValues) => {
    // A reload after a stale save can drop a line; never send a draft for it.
    const assignments = Object.fromEntries(Object.entries(values.assignments).filter(([id]) => lineIds.has(id)));
    if (!baseline || Object.keys(assignments).length === 0) return;
    try {
      await review.mutateAsync({
        observationId: baseline.observationId,
        expectedVersion: baseline.version,
        assignments,
      });
      resetDrafts();
      toast.success(`Template lines saved for ${name}.`);
    } catch (error) {
      setError("root.serverError", {
        type: "server",
        message: toSaveErrorMessage(error, "The template lines were not saved. Try again."),
      });
      if (getStaleVersionConflict(error)) setStale(true);
    }
  };
  const saveError = errors.root?.serverError?.message ?? (errors.assignments ? INVALID_DRAFT_MESSAGE : undefined);

  const reload = () => {
    resetDrafts();
    onRetry();
  };

  const makeDefault = async () => {
    try {
      await setDefault.mutateAsync({ facilityId, removalTemplateId: entry.templateId });
      toast.success(`${name} is now the default Removal template.`);
    } catch (error) {
      toast.error(toSaveErrorMessage(error, "The default Removal template was not changed. Try again."));
    }
  };

  const hasLinesToDecide = linesToDecideCount(entry) > 0;
  const startDeciding = async () => {
    try {
      await startSetup.mutateAsync({ facilityId, removalTemplateId: entry.templateId });
      setExpanded(true);
      toast.success(`The lines of ${name} can now be decided.`);
    } catch (error) {
      toast.error(toSaveErrorMessage(error, "The template was not read. Try again."));
    }
  };
  const bodyId = `${headingId}-lines`;
  // Unsaved drafts and problems that need attention never sit behind "Show lines".
  const needsAttention = missing || notFullyRead;
  const expanded = expandedByToggle || pendingCount > 0 || needsAttention;

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
        <div className="flex shrink-0 flex-wrap items-center gap-8">
          {entry.isDefault ? (
            <StatusBadge status="active" label="Default" size="small" />
          ) : canManage && !missing && (
            <Button size="small" variant="weak" busy={setDefault.isPending} onClick={() => void makeDefault()}>
              Make default
            </Button>
          )}
          {pendingCount === 0 && !needsAttention && (
            <Button
              size="small"
              variant="noOutline"
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? "Hide lines" : "Show lines"}
              <CaretDownIcon
                size={14}
                weight="bold"
                aria-hidden
                className={expanded ? "rotate-180 transition-[rotate] duration-200" : "transition-[rotate] duration-200"}
              />
            </Button>
          )}
        </div>
      </header>

      <div id={bodyId} hidden={!expanded} className="flex flex-col gap-16 px-20 py-16">
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
            {entry.isDefault
              ? "Make another Removal template the default, and switch the credit batches that use it."
              : "Switch the credit batches that use it to another Removal template."}
          </Notice>
        ) : (
          <form
            onSubmit={handleSubmit(save)}
            noValidate
            className="flex flex-col gap-16"
          >
            {entry.preview && (
              <Notice
                tone="info"
                title={NOT_SET_UP_TITLE}
                action={canManage ? (
                  <Button size="small" variant="primary" busy={startSetup.isPending} onClick={() => void startDeciding()}>
                    {hasLinesToDecide ? DECIDE_LINES_LINK_LABEL : SET_UP_TEMPLATE_LABEL}
                  </Button>
                ) : undefined}
              >
                {canManage
                  ? `No facility default or credit batch uses this template yet. ${hasLinesToDecide ? "Decide its lines" : "Set it up"} so credit batches can use it.`
                  : `No facility default or credit batch uses this template yet. Ask an Owner or Admin to ${hasLinesToDecide ? "decide its lines" : "set it up"}.`}
              </Notice>
            )}
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
                Ask an Owner or Admin to decide the lines marked {TO_DECIDE_LABEL}.
              </Notice>
            )}
            <DeprecationFact entry={entry} />

            <RemovalTemplateLineSections
              lines={entry.lines}
              idPrefix={headingId}
              renderLine={(line) => {
                const id = line.component.id;
                return (
                  <RemovalTemplateLineRow
                    key={id}
                    line={line}
                    idPrefix={`${entry.templateId}-${id}`}
                    needsReview={lineNeedsReview(line, entry.lineSourceProblems)}
                    problems={problemMessages(line, entry.lineSourceProblems)}
                    // With no units or factors read every line is unread; the template notice says so once.
                    notFullyRead={!!entry.enrichment && unreadLines.has(id)}
                    enrichment={entry.enrichment?.[id]}
                    showChange={hasEarlierRead}
                    // Without a read there is no observation to save against.
                    canManage={canManage && !!entry.observation}
                    canAcceptProposal={canAcceptProposal(entry, line, pending)}
                    draft={pending[id]}
                    editing={!!editing[id]}
                    onDraftChange={(draft) => setDraft(id, draft)}
                    onEditingChange={(open) => setEditing((current) => ({ ...current, [id]: open }))}
                  />
                );
              }}
            />

            {canManage && !entry.preview && (
              <FormActions
                control={control}
                sticky={false}
                submitVariant="default"
                submitLabel={pendingCount > 1 ? `Save ${pendingCount} lines` : "Save line"}
                submittingLabel="Saving…"
                isSubmitting={isSubmitting || review.isPending}
                submitDisabled={pendingCount === 0 || notFullyRead || !baseline || stale}
                errorMessage={saveError}
                errorAction={stale ? (
                  <Button size="small" variant="weak" busy={isRetrying} onClick={reload}>
                    Discard changes and reload
                  </Button>
                ) : undefined}
              />
            )}
          </form>
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
