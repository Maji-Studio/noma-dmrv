/**
 * PROTOTYPE ONLY (epic #1058 PR 4, empty-line confirmation). Never merged.
 *
 * Three ways for the operator to see and confirm empty template lines in New
 * Removal, inside the real dialog chrome, on fixture batches:
 *   A  on the submit step (plan baseline), one confirmation per batch in "Lines sent";
 *   B  its own "Empty lines" step between selection and submit;
 *   C  inside each compact batch box in selection (#1202 direction).
 *
 * URL: /certification/removals?proto=a|b|c&scenario=one|two&step=select|empty|submit
 *      &confirmed=all (start with every batch confirmed) &note=... &shot=1 (hide switcher)
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { InfoHint } from "@/components/ui/tooltip";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { CREDIT_BATCH_READY_LABEL } from "@/lib/certification/credit-batch-lifecycle";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { lineTotalText, type EmissionLine } from "@/components/emissions/emission-line-display";
import {
  emptyLines,
  protoBatches,
  protoSelection,
  type ProtoBatch,
  type ProtoScenario,
  type ProtoVariant,
} from "./prototype-fixtures";
import {
  BatchCodeLink,
  ConfirmedStrip,
  EmptyLinesConfirm,
  LinesSent,
  SubmitFooter,
  SummaryHead,
  TechnicalDetailsStub,
  blockedReasonFor,
  emissionsHref,
  focusConfirm,
  linesWord,
  type ZeroState,
} from "./prototype-parts";

type StepKey = "select" | "empty" | "submit";

const STEPS: Record<ProtoVariant, { key: StepKey; label: string }[]> = {
  a: [{ key: "select", label: "Select batches" }, { key: "submit", label: "Confirm & submit" }],
  b: [{ key: "select", label: "Select batches" }, { key: "empty", label: "Empty lines" }, { key: "submit", label: "Confirm & submit" }],
  c: [{ key: "select", label: "Select batches" }, { key: "submit", label: "Confirm & submit" }],
};

export interface PrototypeWizardProps {
  variant: ProtoVariant;
  scenario: ProtoScenario;
  initialStep: StepKey;
  startConfirmed: boolean;
  initialNote: string;
  facilityId: string;
  facilityName: string;
  onClose: () => void;
}

export function PrototypeWizard({ variant, scenario, initialStep, startConfirmed, initialNote, facilityId, facilityName, onClose }: PrototypeWizardProps) {
  const all = protoBatches(scenario);
  const steps = STEPS[variant];
  const firstStep = steps.some((s) => s.key === initialStep) ? initialStep : "select";
  const [step, setStep] = useState<StepKey>(firstStep);
  const [furthest, setFurthest] = useState(steps.findIndex((s) => s.key === firstStep));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(firstStep === "select" && variant !== "c" ? [] : protoSelection(scenario)));
  const [zero, setZero] = useState<ZeroState>(() => {
    const ids = protoSelection(scenario);
    return {
      confirmed: startConfirmed ? Object.fromEntries(ids.map((id) => [id, { note: initialNote }])) : {},
      drafts: Object.fromEntries(ids.map((id) => [id, initialNote])),
    };
  });
  const [refused, setRefused] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const chosen = all.filter((b) => selected.has(b.id));
  const blocked = blockedReasonFor(chosen, zero);
  const index = steps.findIndex((s) => s.key === step);

  const go = (key: StepKey) => {
    const next = steps.findIndex((s) => s.key === key);
    setStep(key);
    setFurthest((f) => Math.max(f, next));
    setRefused(false);
  };
  const setNote = (id: string, note: string) => setZero((z) => ({ ...z, drafts: { ...z.drafts, [id]: note } }));
  const confirm = (id: string) => {
    setZero((z) => ({ ...z, confirmed: { ...z.confirmed, [id]: { note: (z.drafts[id] ?? "").trim() } } }));
    setRefused(false);
  };
  const undo = (id: string) => setZero((z) => ({ ...z, confirmed: { ...z.confirmed, [id]: undefined } }));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (scenario === "one") next.clear();
        next.add(id);
      }
      return next;
    });

  const confirmProps = (batch: ProtoBatch) => ({
    batch,
    facilityId,
    note: zero.drafts[batch.id] ?? "",
    onNote: (note: string) => setNote(batch.id, note),
    onConfirm: () => confirm(batch.id),
    refused: refused && blocked.firstId === batch.id,
  });

  return (
    <div className="flex flex-col gap-16">
      <h2 id="new-removal-title" className="title-heading-2">New Removal</h2>
      <StepFlow
        steps={steps as StepFlowStep[]}
        current={index}
        furthest={furthest}
        onNavigate={(i) => go(steps[i].key)}
        footer={null}
        className="gap-16"
      >
        {step === "select" &&
          (variant === "c" ? (
            <SelectCompact
              batches={all}
              selected={selected}
              onToggle={toggle}
              zero={zero}
              confirmProps={confirmProps}
              onUndo={undo}
              facilityId={facilityId}
              oneOnly={scenario === "one"}
            />
          ) : (
            <SelectCards batches={all} selected={selected} onToggle={toggle} oneOnly={scenario === "one"} />
          ))}

        {step === "empty" && (
          <EmptyLinesStep batches={chosen} zero={zero} confirmProps={confirmProps} onUndo={undo} facilityId={facilityId} />
        )}

        {step === "submit" && (
          <div className="flex flex-col gap-24">
            <SummaryHead
              batches={chosen}
              facilityId={facilityId}
              facilityName={facilityName}
              blockedCount={blocked.count}
              blockedDetail={
                variant === "a" ? (
                  "Record them as zero under Lines sent, or add entries on the batch's Emissions page."
                ) : (
                  <button type="button" className="text-[var(--color-interaction)] underline-offset-2 hover:underline" onClick={() => go(variant === "b" ? "empty" : "select")}>
                    {variant === "b" ? "Go to Empty lines" : "Go back to Select batches"}
                  </button>
                )
              }
            />
            <LinesSent
              batches={chosen}
              facilityId={facilityId}
              zero={zero}
              hideUnconfirmedEmpty={variant === "a"}
              showNote={variant !== "a"}
              batchSlot={
                variant === "a"
                  ? (batch) =>
                      emptyLines(batch).length === 0 ? null : zero.confirmed[batch.id] ? (
                        <ConfirmedStrip batch={batch} note={zero.confirmed[batch.id]?.note ?? ""} onUndo={() => undo(batch.id)} />
                      ) : (
                        <EmptyLinesConfirm {...confirmProps(batch)} verb="submit" />
                      )
                  : undefined
              }
            />
            <TechnicalDetailsStub />
            <SubmitFooter
              blockedReason={blocked.reason}
              submitted={submitted}
              onSubmit={() => {
                if (blocked.reason) {
                  setRefused(true);
                  if (variant === "a") focusConfirm(blocked.firstId);
                  return;
                }
                setSubmitted(true);
              }}
            />
          </div>
        )}
      </StepFlow>

      {step !== "submit" && (
        <StepFooter
          variant={variant}
          step={step}
          selectedCount={selected.size}
          readyCount={all.filter((b) => !b.issues.length).length}
          total={all.length}
          blockedReason={variant === "c" || step === "empty" ? blocked.reason : null}
          onCancel={onClose}
          onContinue={() => {
            if (!selected.size) return;
            if ((variant === "c" || step === "empty") && blocked.reason) {
              setRefused(true);
              focusConfirm(blocked.firstId);
              return;
            }
            go(variant === "b" && step === "select" ? "empty" : "submit");
          }}
        />
      )}
    </div>
  );
}

/* ---------- footers ---------- */

function StepFooter({ variant, step, selectedCount, readyCount, total, blockedReason, onCancel, onContinue }: {
  variant: ProtoVariant;
  step: StepKey;
  selectedCount: number;
  readyCount: number;
  total: number;
  blockedReason: string | null;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-start gap-x-16 gap-y-12 border-t border-[var(--color-border-secondary)] pt-16">
      <div className="flex items-center gap-12">
        <Button variant="primary" onClick={onContinue}>Continue</Button>
        {step === "select" && <Button variant="default" onClick={onCancel}>Cancel</Button>}
      </div>
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {blockedReason && (variant !== "c" || selectedCount > 0)
          ? blockedReason
          : step === "select"
            ? `${readyCount} of ${total} batches with complete data · ${selectedCount} selected`
            : null}
      </span>
    </div>
  );
}

/* ---------- A and B: today's selection cards ---------- */

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="body-caption text-[var(--color-text-tertiary)]">{label}</span>
      <span className="truncate body-small text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}

function SelectCards({ batches, selected, onToggle, oneOnly }: { batches: ProtoBatch[]; selected: Set<string>; onToggle: (id: string) => void; oneOnly: boolean }) {
  const ready = batches.filter((b) => !b.issues.length);
  const notReady = batches.filter((b) => b.issues.length);
  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-3 flex items-center gap-6">
        Select credit batches
        <InfoHint>Only batches whose data is complete can be grouped into a Removal.</InfoHint>
      </h3>
      {oneOnly && (
        <p className="body-small text-[var(--color-text-secondary)]">Select one credit batch. Each 1000-year credit batch needs a separate Removal.</p>
      )}
      <div className="grid grid-cols-1 gap-12 sm:grid-cols-2">
        {ready.map((batch) => {
          const isSelected = selected.has(batch.id);
          return (
            <label
              key={batch.id}
              className={cn(
                "flex cursor-pointer flex-col gap-12 border bg-[var(--color-background-white)] p-16 transition-colors",
                isSelected ? "border-[var(--color-interaction)]" : "border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)]",
              )}
            >
              <div className="flex items-start justify-between gap-12">
                <span className="body-small text-[var(--color-text-primary)]">{formatDateRange(batch.startDate, batch.endDate)}</span>
                <input type="checkbox" className="mt-px size-16 shrink-0 accent-[var(--color-interaction)]" checked={isSelected} onChange={() => onToggle(batch.id)} aria-label={`Select credit batch ${batch.code}`} />
              </div>
              <span className="body-caption text-[var(--color-text-tertiary)]">Credit batch {batch.code}</span>
              <div className="grid grid-cols-2 gap-8">
                <Metric label="Weight" value={formatTonnes(batch.dryTons)} />
                <Metric label="Durability" value={batch.durability} />
              </div>
              <span className="inline-flex items-center gap-6 body-caption font-medium text-[var(--st-ok)]">
                <CheckCircleIcon size={14} weight="fill" aria-hidden />
                {CREDIT_BATCH_READY_LABEL}
              </span>
            </label>
          );
        })}
      </div>
      <details className="group flex flex-col">
        <summary className="flex cursor-pointer list-none items-center gap-8 py-4 [&::-webkit-details-marker]:hidden">
          <CaretDownIcon size={14} aria-hidden className="shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 group-open:rotate-180" />
          <span className="body-small font-medium text-[var(--color-text-secondary)]">Not ready yet ({notReady.length})</span>
        </summary>
      </details>
    </div>
  );
}

/* ---------- B: the Empty lines step ---------- */

function EmptyLinesStep({ batches, zero, confirmProps, onUndo, facilityId }: {
  batches: ProtoBatch[];
  zero: ZeroState;
  confirmProps: (batch: ProtoBatch) => Parameters<typeof EmptyLinesConfirm>[0];
  onUndo: (id: string) => void;
  facilityId: string;
}) {
  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-3 flex items-center gap-6">
        Empty lines
        <InfoHint>
          A line with nothing this batch reaches Isometric only as a recorded zero. Record the zeros here, or add an entry on the
          batch&apos;s Emissions page instead.
        </InfoHint>
      </h3>
      {batches.map((batch) => {
        const n = emptyLines(batch).length;
        const confirmed = zero.confirmed[batch.id];
        return (
          <div key={batch.id} className="flex flex-col bg-[var(--paper)] [border:var(--panel-border)]">
            <div className="flex flex-wrap items-center justify-between gap-x-12 gap-y-4 bg-[var(--sea)] px-16 py-10">
              <span className="inline-flex flex-wrap items-baseline gap-x-8 body-small font-medium">
                <BatchCodeLink batch={batch} facilityId={facilityId} />
                <span className="font-normal text-[var(--color-text-secondary)]">{formatDateRange(batch.startDate, batch.endDate)}</span>
              </span>
              {n === 0 ? (
                <StateText ok>No empty lines</StateText>
              ) : confirmed ? (
                <StateText ok>{linesWord(n)} recorded as zero</StateText>
              ) : (
                <StateText>{linesWord(n)} not recorded</StateText>
              )}
            </div>
            {n === 0 ? (
              <p className="px-16 py-12 body-small text-[var(--color-text-secondary)]">
                Every line has an entry or automatic datapoints.
              </p>
            ) : confirmed ? (
              <>
                <ul className="flex flex-col">
                  {emptyLines(batch).map((line) => (
                    <li key={line.componentId} className="flex items-center justify-between gap-12 px-16 py-8 body-small [border-top:var(--row-divider)]">
                      <span className="min-w-0">{line.displayName}</span>
                      <span className="shrink-0 tabular-nums">{lineTotalText({ ...line, state: "confirmedZero" } as EmissionLine)}</span>
                    </li>
                  ))}
                </ul>
                <ConfirmedStrip batch={batch} note={confirmed.note} onUndo={() => onUndo(batch.id)} hideTitle />
              </>
            ) : (
              <EmptyLinesConfirm {...confirmProps(batch)} addEntry hideTitle />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StateText({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-6 body-caption font-medium", ok ? "text-[var(--st-ok)]" : "text-[var(--color-signal-orange-strong)]")}>
      {ok ? <CheckCircleIcon size={14} weight="fill" aria-hidden /> : <WarningIcon size={14} weight="fill" aria-hidden />}
      {children}
    </span>
  );
}

/* ---------- C: compact boxes in selection (#1202) ---------- */

function issueLine(issues: string[]): string {
  if (issues.length === 1) return issues[0];
  return `${issues[0]} and ${issues.length - 1} more`;
}

function SelectCompact({ batches, selected, onToggle, zero, confirmProps, onUndo, facilityId, oneOnly }: {
  batches: ProtoBatch[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  zero: ZeroState;
  confirmProps: (batch: ProtoBatch) => Parameters<typeof EmptyLinesConfirm>[0];
  onUndo: (id: string) => void;
  facilityId: string;
  oneOnly: boolean;
}) {
  const ready = batches.filter((b) => !b.issues.length);
  const notReady = batches.filter((b) => b.issues.length);
  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-3 flex items-center gap-6">
        Select credit batches
        <InfoHint>
          Only batches whose data is complete can be grouped into a Removal. A line with nothing this batch reaches Isometric only
          as a recorded zero.
        </InfoHint>
      </h3>
      {oneOnly && (
        <p className="body-small text-[var(--color-text-secondary)]">Select one credit batch. Each 1000-year credit batch needs a separate Removal.</p>
      )}
      <ul className="flex flex-col gap-8">
        {ready.map((batch) => {
          const isSelected = selected.has(batch.id);
          const n = emptyLines(batch).length;
          const confirmed = zero.confirmed[batch.id];
          return (
            <li
              key={batch.id}
              className={cn(
                "flex flex-col border bg-[var(--color-background-white)] transition-colors",
                isSelected ? "border-[var(--color-interaction)]" : "border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)]",
              )}
            >
              <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-12 gap-y-4 px-16 py-12">
                <input
                  type="checkbox"
                  className="mt-4 size-16 shrink-0 accent-[var(--color-interaction)]"
                  checked={isSelected}
                  onChange={() => onToggle(batch.id)}
                  aria-label={`Select credit batch ${batch.code}`}
                />
                <span className="flex min-w-0 flex-col gap-2">
                  <span className="flex flex-wrap items-baseline gap-x-8">
                    <BatchCodeLink batch={batch} facilityId={facilityId} />
                    <span className="body-small text-[var(--color-text-secondary)]">{formatDateRange(batch.startDate, batch.endDate)}</span>
                  </span>
                  {n === 0 ? (
                    <StateText ok>{CREDIT_BATCH_READY_LABEL}</StateText>
                  ) : confirmed ? (
                    <StateText ok>{linesWord(n)} recorded as zero</StateText>
                  ) : (
                    <StateText>{linesWord(n)} not recorded</StateText>
                  )}
                </span>
                <span className="body-small font-mono tabular-nums text-[var(--color-text-primary)]">{formatTonnes(batch.dryTons)}</span>
              </label>
              {isSelected && n > 0 && (
                <div className="flex flex-col gap-12 px-16 pb-16 pl-44">
                  {confirmed ? (
                    <ConfirmedStrip batch={batch} note={confirmed.note} onUndo={() => onUndo(batch.id)} compact hideTitle />
                  ) : (
                    <>
                      <span className="body-small text-[var(--color-text-secondary)]">
                        Record these lines as zero, or{" "}
                        <Link href={emissionsHref(batch, facilityId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-4 font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline">
                          add entries
                          <ArrowSquareOutIcon size={12} aria-hidden />
                        </Link>
                        .
                      </span>
                      <EmptyLinesConfirm {...confirmProps(batch)} compact />
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {notReady.map((batch) => (
          <li key={batch.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-12 gap-y-4 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] px-16 py-12 pl-44">
            <span className="flex min-w-0 flex-col gap-2">
              <span className="flex flex-wrap items-baseline gap-x-8">
                <span className="font-mono body-small text-[var(--color-text-secondary)]">{batch.code}</span>
                <span className="body-small text-[var(--color-text-tertiary)]">{formatDateRange(batch.startDate, batch.endDate)}</span>
              </span>
              <StateText>
                {batch.issues.length} {batch.issues.length === 1 ? "issue" : "issues"}: {issueLine(batch.issues)}
              </StateText>
            </span>
            <Link
              href={creditBatchDeepLinkHref(batch.id, facilityId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-44 items-center gap-4 self-center body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
            >
              Open checklist
              <ArrowSquareOutIcon size={12} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
