/**
 * PROTOTYPE ONLY (epic #1058 PR 4, empty-line confirmation). Never merged.
 * Shared pieces of the three variants: the "Lines sent" list, the empty-line
 * confirmation and its confirmed strip with Undo, the submit summary head and
 * the submit footer.
 */
"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowSquareOutIcon,
  ChatTextIcon,
  CheckCircleIcon,
  PaperclipIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { InfoHint } from "@/components/ui/tooltip";
import { DetailField } from "@/components/ui/detail-panel";
import { Notice } from "@/components/ui/notice";
import { FormField } from "@/components/forms/form-field";
import { FormTextarea } from "@/components/forms/form-textarea";
import { DerivedHeadline } from "@/components/forms/derived-headline";
import { SectionLabel } from "@/components/forms/section-label";
import {
  groupLines,
  hasRecordsFigure,
  lineTotalText,
  manualEntriesText,
  valueEntries,
  type EmissionLine,
} from "@/components/emissions/emission-line-display";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { pluralize } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import { PROTO_ACTOR, PROTO_CONFIRMED_AT, emptyLines, type ProtoBatch } from "./prototype-fixtures";

const ICON = 14;
const LINK_ICON = 12;
export const NOTE_HINT = "The note stays in noma. Isometric receives 0 for each line, with no file.";

/** What the operator decided per batch: confirmed zeros (with the note) and note drafts. */
export interface ZeroState {
  confirmed: Record<string, { note: string } | undefined>;
  drafts: Record<string, string>;
}

export function linesWord(count: number): string {
  return `${count} ${pluralize(count, "line", "lines")}`;
}

/** The line as it is sent: an empty line confirmed for this Removal reads as a recorded zero. */
function asSent(line: EmissionLine, zero: boolean): EmissionLine {
  return zero && line.state === "empty" ? ({ ...line, state: "confirmedZero" } as EmissionLine) : line;
}

/** Where the value comes from, in the words the Emissions page uses. */
export function sourceText(line: EmissionLine): string {
  if (line.state === "confirmedZero") return "Recorded zero";
  const auto = hasRecordsFigure(line.records);
  const manual = valueEntries(line).length;
  if (auto && manual) return `Automatic datapoints, ${manualEntriesText(manual)}`;
  if (auto) return "Automatic datapoints";
  if (manual) return manualEntriesText(manual);
  return "None";
}

export function BatchCodeLink({ batch, facilityId }: { batch: ProtoBatch; facilityId: string }) {
  return (
    <Link
      href={creditBatchDeepLinkHref(batch.id, facilityId)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="relative inline-flex items-center gap-4 font-mono text-[var(--color-text-primary)] underline-offset-4 hover:text-[var(--color-interaction)] hover:underline"
    >
      {batch.code}
      <ArrowSquareOutIcon size={LINK_ICON} aria-hidden />
    </Link>
  );
}

export function emissionsHref(batch: ProtoBatch, facilityId: string): string {
  return `/emissions/${batch.id}?facility=${facilityId}`;
}

/* ---------- Lines sent ---------- */

const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-12 gap-y-4 md:grid-cols-[minmax(0,1fr)_minmax(0,272px)_80px_104px] md:items-center";

function FilesCell({ files }: { files: string[] }) {
  if (!files.length) return <span className="text-[var(--color-text-tertiary)]">None</span>;
  return (
    <span className="inline-flex items-center gap-4 text-[var(--color-text-secondary)]" title={files.join(", ")}>
      <PaperclipIcon size={ICON} aria-hidden />
      {files.length} {pluralize(files.length, "file", "files")}
    </span>
  );
}

function SentRow({ line, files }: { line: EmissionLine; files: string[] }) {
  const missing = line.state === "empty";
  return (
    <li className={cn(ROW_GRID, "px-16 py-10 [border-top:var(--row-divider)]")}>
      <span className="col-span-2 body-small text-[var(--color-text-primary)] md:col-span-1">{line.displayName}</span>
      <span className="col-start-1 row-start-2 flex flex-wrap items-center gap-x-8 body-small text-[var(--color-text-secondary)] md:col-auto md:row-auto">
        <span>{sourceText(line)}</span>
        {files.length > 0 && (
          <span className="whitespace-nowrap md:hidden">
            <FilesCell files={files} />
          </span>
        )}
      </span>
      <span className="hidden body-small md:block"><FilesCell files={files} /></span>
      <span
        className={cn(
          "col-start-2 row-start-2 text-right body-small font-mono tabular-nums md:col-auto md:row-auto",
          missing ? "text-[var(--color-text-tertiary)]" : "text-[var(--color-text-primary)]",
        )}
      >
        {lineTotalText(line)}
      </span>
    </li>
  );
}

interface LinesSentProps {
  batches: ProtoBatch[];
  facilityId: string;
  zero: ZeroState;
  /** Variant A: unconfirmed empty lines stay grouped behind the confirmation, not in the list. */
  hideUnconfirmedEmpty?: boolean;
  /** Rendered between the batch header and its lines (Variant A's confirmation). */
  batchSlot?: (batch: ProtoBatch) => ReactNode;
  /** Read-only variants repeat the note under the list; A shows it in the confirmed strip. */
  showNote?: boolean;
}

export function LinesSent({ batches, facilityId, zero, hideUnconfirmedEmpty, batchSlot, showNote }: LinesSentProps) {
  return (
    <section className="flex flex-col gap-12" aria-label="Lines sent">
      <SectionLabel hint="What Isometric receives for each line of the Removal template, per credit batch.">Lines sent</SectionLabel>
      {batches.map((batch) => {
        const confirmed = zero.confirmed[batch.id];
        const lines = batch.lines
          .filter((line) => !(hideUnconfirmedEmpty && !confirmed && line.state === "empty"))
          .map((line) => asSent(line, !!confirmed));
        const zeros = confirmed ? emptyLines(batch).length : 0;
        return (
          <div key={batch.id} className="flex flex-col bg-[var(--paper)] [border:var(--panel-border)]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-12 gap-y-4 bg-[var(--sea)] px-16 py-10">
              <span className="inline-flex flex-wrap items-baseline gap-x-8 body-small font-medium">
                <BatchCodeLink batch={batch} facilityId={facilityId} />
                <span className="font-normal text-[var(--color-text-secondary)]">{formatDateRange(batch.startDate, batch.endDate)}</span>
              </span>
              <span className="body-caption text-[var(--color-text-secondary)]">
                {linesWord(batch.lines.length)}
                {showNote && zeros > 0 && `, ${zeros} recorded as zero`}
              </span>
            </div>
            {batchSlot?.(batch)}
            <ul aria-label={`Lines sent for ${batch.code}`}>
              {groupLines(lines).map((group) => (
                <Fragment key={group.key}>
                  <li className="px-16 pt-12 pb-2 body-caption font-medium text-[var(--color-text-tertiary)] [border-top:var(--row-divider)]">
                    {group.label}
                  </li>
                  {group.lines.map((line) => (
                    <SentRow key={line.componentId} line={line} files={batch.files[line.componentId] ?? []} />
                  ))}
                </Fragment>
              ))}
            </ul>
            {showNote && confirmed?.note && (
              <p className="flex items-start gap-8 px-16 py-10 body-caption text-[var(--color-text-secondary)] [border-top:var(--row-divider)]">
                <ChatTextIcon size={ICON} aria-hidden className="mt-2 shrink-0" />
                <span>Note on the recorded zeros: {confirmed.note}</span>
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ---------- Confirmation ---------- */

interface EmptyLinesConfirmProps {
  batch: ProtoBatch;
  facilityId: string;
  note: string;
  onNote: (note: string) => void;
  onConfirm: () => void;
  /** Variant B: each line also offers Add entry on the batch's Emissions page. */
  addEntry?: boolean;
  /** Variant C: lines as one short list, smaller note box. */
  compact?: boolean;
  /** Heading copy; A uses the plan's sentence. */
  title?: string;
  /** Shown after a refused Continue or Submit. */
  refused?: boolean;
  /** The batch header already states the count (B): keep only the instruction. */
  hideTitle?: boolean;
  /** The action the refusal names. */
  verb?: "continue" | "submit";
}

export function EmptyLinesConfirm({ batch, facilityId, note, onNote, onConfirm, addEntry, compact, title, refused, hideTitle, verb = "continue" }: EmptyLinesConfirmProps) {
  const lines = emptyLines(batch);
  const n = lines.length;
  const noteId = `zero-note-${batch.id}`;
  return (
    <div
      id={`zero-confirm-${batch.id}`}
      className={cn("flex flex-col gap-12", !compact && "px-16 py-16 [border-top:var(--row-divider)]")}
    >
      {!compact && hideTitle && (
        <span className="body-small text-[var(--color-text-secondary)]">
          Record these lines as zero, or add an entry to a line on the Emissions page.
        </span>
      )}
      {!compact && !hideTitle && (
        <div className="flex items-start gap-8">
          <WarningIcon size={18} weight="fill" aria-hidden className="mt-2 shrink-0 text-[var(--color-signal-orange-strong)]" />
          <span className="flex flex-col gap-2">
            <span className="body-medium font-medium text-[var(--color-text-primary)]">
              {title ?? `These ${n} lines had nothing this batch`}
            </span>
            <span className="body-small text-[var(--color-text-secondary)]">
              Record them as zero, or add entries on the Emissions page.
            </span>
          </span>
        </div>
      )}
      <ul className={cn("flex flex-col", compact && "gap-2")}>
        {lines.map((line) => (
          <li
            key={line.componentId}
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-12 body-small",
              compact ? "text-[var(--color-text-secondary)]" : "py-8 [border-top:var(--row-divider)] last:[border-bottom:var(--row-divider)]",
            )}
          >
            <span className="min-w-0">{line.displayName}</span>
            {addEntry && (
              <Link
                href={emissionsHref(batch, facilityId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-44 items-center gap-4 body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline md:min-h-0"
              >
                Add entry
                <ArrowSquareOutIcon size={LINK_ICON} aria-hidden />
              </Link>
            )}
          </li>
        ))}
      </ul>
      <FormField id={noteId} label="Note" hint={NOTE_HINT}>
        <FormTextarea
          id={noteId}
          value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder="For example: no staff travel in September."
          className={compact ? "min-h-[64px]" : "min-h-[72px]"}
        />
      </FormField>
      {refused && (
        <p className="body-small text-[var(--st-bad)]" role="alert">
          These {linesWord(n)} need a recorded zero or an entry before you {verb}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-12">
        <Button variant="default" onClick={onConfirm}>
          Record {linesWord(n)} as zero
        </Button>
      </div>
    </div>
  );
}

export function ConfirmedStrip({ batch, note, onUndo, compact, hideTitle }: { batch: ProtoBatch; note: string; onUndo?: () => void; compact?: boolean; hideTitle?: boolean }) {
  const n = emptyLines(batch).length;
  return (
    <div
      role="status"
      className={cn("flex flex-wrap items-center justify-between gap-x-12 gap-y-8", !compact && "px-16 py-12 [border-top:var(--row-divider)]")}
    >
      <span className="flex min-w-0 items-start gap-8">
        {!hideTitle && <CheckCircleIcon size={18} weight="fill" aria-hidden className="mt-2 shrink-0 text-[var(--st-ok)]" />}
        <span className="flex min-w-0 flex-col gap-2">
          {!hideTitle && (
            <span className="body-small font-medium text-[var(--color-text-primary)]">
              {linesWord(n)} recorded as zero
            </span>
          )}
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {hideTitle ? "Recorded by " : ""}
            {PROTO_ACTOR}, {PROTO_CONFIRMED_AT}
          </span>
          {note && (
            <span className="flex items-start gap-6 body-small text-[var(--color-text-secondary)]">
              <ChatTextIcon size={ICON} aria-hidden className="mt-4 shrink-0" />
              {note}
            </span>
          )}
        </span>
      </span>
      {onUndo && (
        <Button size="small" variant="default" onClick={onUndo}>
          Undo
        </Button>
      )}
    </div>
  );
}

/* ---------- Submit step ---------- */

export function SummaryHead({
  batches,
  facilityId,
  facilityName,
  blockedCount,
  blockedDetail,
}: {
  batches: ProtoBatch[];
  facilityId: string;
  facilityName: string;
  blockedCount: number;
  blockedDetail: ReactNode;
}) {
  const tons = batches.reduce((sum, batch) => sum + batch.dryTons, 0);
  const start = batches.map((b) => b.startDate).sort()[0];
  const end = batches.map((b) => b.endDate).sort().at(-1) ?? start;
  return (
    <div className="flex flex-col gap-24">
      <div className="flex items-start gap-12" role={blockedCount ? "alert" : "status"}>
        <span className="mt-2">
          {blockedCount ? (
            <WarningIcon size={20} weight="fill" aria-hidden className="shrink-0 text-[var(--st-bad)]" />
          ) : (
            <CheckCircleIcon size={20} weight="fill" aria-hidden className="shrink-0 text-[var(--st-ok)]" />
          )}
        </span>
        <div className="flex flex-col gap-2">
          <span className="body-medium font-medium text-[var(--color-text-primary)]">
            {blockedCount
              ? `${blockedCount} empty ${pluralize(blockedCount, "line blocks", "lines block")} submission`
              : "Ready to submit"}
          </span>
          <span className="body-small text-[var(--color-text-secondary)]">
            {blockedCount ? blockedDetail : "14 checks passed."}
          </span>
        </div>
      </div>
      <DerivedHeadline
        label={
          <>
            You are sending
            <InfoHint label="About the CO₂e figures">Isometric calculates stored and net CO₂e after submission.</InfoHint>
          </>
        }
        value={formatTonnes(tons)}
        sub="Biochar, dry mass"
      />
      <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
        <DetailField label="Destination" value="Dark Earth Carbon (Sandbox)" />
        <DetailField label="Facility" value={facilityName} />
        <DetailField label="Reporting window" value={formatDateRange(start, end)} />
        <DetailField
          label={batches.length === 1 ? "Credit batch" : "Credit batches"}
          value={
            <span className="flex flex-col gap-2">
              {batches.map((b) => (
                <BatchCodeLink key={b.id} batch={b} facilityId={facilityId} />
              ))}
            </span>
          }
        />
      </div>
    </div>
  );
}

export function SubmitFooter({ blockedReason, onSubmit, submitted }: { blockedReason: string | null; onSubmit: () => void; submitted: boolean }) {
  return (
    <div className="flex flex-col gap-12 border-t border-[var(--color-border-secondary)] pt-16">
      {submitted && !blockedReason && (
        <Notice tone="success">Prototype: the Removal would be submitted now.</Notice>
      )}
      <div className="flex flex-wrap items-center justify-start gap-x-12 gap-y-8">
        <div className="flex items-center gap-12">
          {/* BTN-09: Submit stays pressable; pressing it while blocked jumps to the confirmation. */}
          <Button variant="primary" onClick={onSubmit}>
            Submit Removal
          </Button>
          <Button variant="default">Discard draft</Button>
        </div>
        {blockedReason && (
          <span className="body-caption text-[var(--color-text-secondary)]">{blockedReason}</span>
        )}
      </div>
    </div>
  );
}

export function TechnicalDetailsStub() {
  return (
    <div className="flex items-center justify-between gap-12 bg-[var(--color-background-white)] px-16 py-10 [border:var(--panel-border)]">
      <span className="body-small text-[var(--color-text-primary)]">Technical details</span>
      <span className="body-caption text-[var(--color-text-tertiary)]">Registry submission data</span>
    </div>
  );
}

export function blockedReasonFor(batches: ProtoBatch[], zero: ZeroState): { count: number; reason: string | null; firstId: string | null } {
  const open = batches.filter((b) => emptyLines(b).length > 0 && !zero.confirmed[b.id]);
  const count = open.reduce((sum, b) => sum + emptyLines(b).length, 0);
  if (!open.length) return { count: 0, reason: null, firstId: null };
  const codes = open.map((b) => b.code).join(" and ");
  return {
    count,
    reason: `Record the ${linesWord(count)} with nothing in ${codes} as zero, or add entries.`,
    firstId: open[0].id,
  };
}

export function focusConfirm(batchId: string | null) {
  if (!batchId) return;
  const el = document.getElementById(`zero-confirm-${batchId}`);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  el?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
}
