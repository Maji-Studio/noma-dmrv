/**
 * EmptyComponentsStep — the "Empty components" step of the New-Removal wizard
 * (epic #1058, PR 4). One card per selected credit batch lists the components
 * with nothing recorded for this Removal. The operator adds an entry on the
 * batch's Emissions page (a new tab), or records the rest as zero with one
 * optional note. Undo lives here and only here; the submit step is read-only.
 */
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowSquareOutIcon,
  ChatTextIcon,
  CheckCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { FormField } from "@/components/forms/form-field";
import { FormTextarea } from "@/components/forms/form-textarea";
import { InfoHint } from "@/components/ui/tooltip";
import { emissionsBatchHref } from "@/components/emissions/emissions-overview-query";
import { MAX_NOTE_LENGTH } from "@/components/emissions/emission-line-display";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { formatDateRange, formatDateTime } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import type {
  EmptyComponentsActions,
  RemovalEmptyComponents,
  RemovalEmptyComponentsBatch,
} from "@/hooks/use-removal-empty-components";
import {
  componentsWord,
  recordedAt,
  recordedNote,
  stepRows,
} from "@/lib/certification/empty-components-state";

const LINK_ICON_SIZE = 12;
const STATE_ICON_SIZE = 14;
const NOTE_PLACEHOLDER = "For example: no staff travel in September.";
const NOTE_HINT =
  "The note is copied to each recorded zero. It stays in noma. Isometric receives 0 for each component, with no file.";
const STEP_HINT =
  "A component with nothing for this Removal reaches Isometric only as a recorded zero. Record the zeros here, or add an entry on the batch's Emissions page instead.";

interface BatchDates {
  startDate: string;
  endDate: string;
}

/** Asks a card to put the cursor in its note; a new nonce asks again. */
export interface FocusRequest {
  batchId: string;
  nonce: number;
}

interface EmptyComponentsStepProps {
  removalId: string;
  facilityId: string;
  data: RemovalEmptyComponents | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Start and end of each selected batch, by credit batch id. */
  batchDates: Record<string, BatchDates>;
  actions: EmptyComponentsActions;
  focusRequest: FocusRequest | null;
}

export function EmptyComponentsStep({
  removalId,
  facilityId,
  data,
  isLoading,
  isError,
  batchDates,
  actions,
  focusRequest,
}: EmptyComponentsStepProps) {
  if (isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">Loading…</p>
    );
  }
  if (isError || !data) {
    return (
      <p className="body-small text-[var(--st-bad)]" role="alert">
        The empty components could not be loaded. Refresh the page.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-3 flex items-center gap-6">
        Empty components
        <InfoHint>{STEP_HINT}</InfoHint>
      </h3>
      {data.batches.map((batch) => (
        <BatchCard
          key={batch.creditBatchId}
          batch={batch}
          removalId={removalId}
          removalVersion={data.removalVersion}
          facilityId={facilityId}
          dates={batchDates[batch.creditBatchId]}
          editable={data.editable}
          actions={actions}
          focusNonce={
            focusRequest?.batchId === batch.creditBatchId
              ? focusRequest.nonce
              : null
          }
        />
      ))}
    </div>
  );
}

function StateText({
  ok,
  children,
}: {
  ok?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-6 body-caption font-medium",
        ok
          ? "text-[var(--st-ok)]"
          : "text-[var(--color-signal-orange-strong)]",
      )}
    >
      {ok ? (
        <CheckCircleIcon size={STATE_ICON_SIZE} weight="fill" aria-hidden />
      ) : (
        <WarningIcon size={STATE_ICON_SIZE} weight="fill" aria-hidden />
      )}
      {children}
    </span>
  );
}

function BatchCard({
  batch,
  removalId,
  removalVersion,
  facilityId,
  dates,
  editable,
  actions,
  focusNonce,
}: {
  batch: RemovalEmptyComponentsBatch;
  removalId: string;
  removalVersion: number | null;
  facilityId: string;
  dates: BatchDates | undefined;
  editable: boolean;
  actions: EmptyComponentsActions;
  focusNonce: number | null;
}) {
  const [note, setNote] = useState("");
  const handledFocus = useRef<number | null>(null);
  const open = batch.lines.length;
  const recorded = batch.zeros.length;
  const noteId = `zero-note-${batch.creditBatchId}`;
  const scope = {
    removalId,
    creditBatchId: batch.creditBatchId,
    expectedRemovalVersion: removalVersion,
  };
  const error =
    actions.errorBatchId === batch.creditBatchId ? actions.error : null;
  const mine = actions.pendingBatchId === batch.creditBatchId;
  const savedNote = recordedNote(batch);
  const savedAt = recordedAt(batch);
  // A row names its state only when the rows differ; the header says it otherwise.
  const mixed = open > 0 && recorded > 0;

  return (
    <section
      aria-label={`Empty components in ${batch.code}`}
      className="flex flex-col bg-[var(--paper)] [border:var(--panel-border)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-12 gap-y-4 bg-[var(--sea)] px-16 py-10">
        <span className="inline-flex flex-wrap items-baseline gap-x-8 body-small font-medium">
          <Link
            href={creditBatchDeepLinkHref(batch.creditBatchId, facilityId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-4 font-mono text-[var(--color-text-primary)] underline-offset-4 hover:text-[var(--color-interaction)] hover:underline"
          >
            {batch.code}
            <ArrowSquareOutIcon size={LINK_ICON_SIZE} aria-hidden />
          </Link>
          {dates && (
            <span className="font-normal text-[var(--color-text-secondary)]">
              {formatDateRange(dates.startDate, dates.endDate)}
            </span>
          )}
        </span>
        {/* Always mounted, so a change of state is announced. */}
        <span role="status">
          {open > 0 ? (
            <StateText>{componentsWord(open)} not recorded</StateText>
          ) : recorded > 0 ? (
            <StateText ok>{componentsWord(recorded)} recorded as zero</StateText>
          ) : (
            <StateText ok>No empty components</StateText>
          )}
        </span>
      </div>

      {open === 0 && recorded === 0 && (
        <p className="px-16 py-12 body-small text-[var(--color-text-secondary)]">
          Every component has an entry or automatic datapoints.
        </p>
      )}

      {(open > 0 || recorded > 0) && (
        <ul className="flex flex-col" aria-label={`Components in ${batch.code}`}>
          {stepRows(batch).map((row) =>
            row.recorded ? (
              <li
                key={row.componentId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-12 px-16 py-8 body-small [border-top:var(--row-divider)]"
              >
                <span className="min-w-0">{row.name}</span>
                {mixed && (
                  <span className="body-caption text-[var(--color-text-secondary)]">
                    Recorded zero
                  </span>
                )}
              </li>
            ) : (
              <li
                key={row.componentId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-12 px-16 py-4 body-small [border-top:var(--row-divider)]"
              >
                <span className="min-w-0">{row.name}</span>
                <Link
                  href={emissionsBatchHref(batch.creditBatchId, {
                    facility: facilityId,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Add entry for ${row.name}`}
                  className="inline-flex min-h-44 items-center gap-4 body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline md:min-h-32"
                >
                  Add entry
                  <ArrowSquareOutIcon size={LINK_ICON_SIZE} aria-hidden />
                </Link>
              </li>
            ),
          )}
        </ul>
      )}

      {editable && open > 0 && (
        <div
          id={`zero-confirm-${batch.creditBatchId}`}
          className="flex flex-col gap-12 px-16 py-16 [border-top:var(--row-divider)]"
        >
          <FormField id={noteId} label="Note (optional)" hint={NOTE_HINT}>
            <FormTextarea
              id={noteId}
              ref={(element) => {
                // After the card has mounted: a refused Continue puts the cursor here once.
                if (element && focusNonce !== null && handledFocus.current !== focusNonce) {
                  handledFocus.current = focusNonce;
                  element.scrollIntoView({ block: "center", behavior: "smooth" });
                  element.focus({ preventScroll: true });
                }
              }}
              value={note}
              maxLength={MAX_NOTE_LENGTH}
              onChange={(event) => setNote(event.target.value)}
              placeholder={NOTE_PLACEHOLDER}
              className="min-h-72"
            />
          </FormField>
          <div className="flex flex-wrap items-center gap-12">
            <Button
              variant="default"
              busy={mine && actions.busy}
              disabled={actions.busy}
              onClick={() =>
                actions.recordZeros({
                  ...scope,
                  componentIds: batch.lines.map((line) => line.componentId),
                  note,
                })
              }
            >
              Record {componentsWord(open)} as zero
            </Button>
          </div>
        </div>
      )}

      {recorded > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-12 gap-y-8 px-16 py-12 [border-top:var(--row-divider)]">
          <span className="flex min-w-0 flex-col gap-2">
            {savedAt && (
              <span className="body-caption text-[var(--color-text-tertiary)]">
                Recorded {formatDateTime(savedAt)}
              </span>
            )}
            {savedNote && (
              <span className="flex items-start gap-6 body-small text-[var(--color-text-secondary)]">
                <ChatTextIcon
                  size={STATE_ICON_SIZE}
                  aria-hidden
                  className="mt-4 shrink-0"
                />
                {savedNote}
              </span>
            )}
          </span>
          {editable && (
            <Button
              variant="default"
              busy={mine && actions.busy}
              disabled={actions.busy}
              onClick={() => actions.undoZeros(scope)}
            >
              Undo
            </Button>
          )}
        </div>
      )}

      {error && (
        <p
          className="px-16 pb-12 body-small text-[var(--st-bad)]"
          role="alert"
        >
          {error.message}
        </p>
      )}
    </section>
  );
}
