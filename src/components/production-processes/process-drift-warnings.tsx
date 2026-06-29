/**
 * ProcessDriftWarnings — the two trailing-window Method-B compliance counters for
 * a production process (ADR 0017 Track 2, item 7 / D6).
 *
 * WARN, never block: noma surfaces (1) missed required samplings and (2) sub-3σ
 * carbon measurements as they approach / reach their protocol review triggers.
 * The registry is the detector of record (it holds the raw samples per ADR 0013);
 * noma never auto-acts — the only remedy here is the human "start a new process"
 * reset, surfaced by the panel that hosts this card.
 *
 * Pure presentational + one lazy query (`useProcessComplianceDrift`); render it
 * only when a process is selected so the query stays scoped.
 */
"use client";

import {
  CheckCircleIcon,
  WarningCircleIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useProcessComplianceDrift } from "@/hooks/use-production-processes";
import type {
  MissedSamplingsResult,
  SubThreeSigmaResult,
} from "@/lib/certification/compliance-drift";
import { InfoHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Tone = "ok" | "wait" | "bad";

const TONE_BOX: Record<Tone, string> = {
  ok: "border-[var(--st-ok-border)] bg-[var(--st-ok-bg)]",
  wait: "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)]",
  bad: "border-[var(--st-bad-border)] bg-[var(--st-bad-bg)]",
};

const TONE_INK: Record<Tone, string> = {
  ok: "text-[var(--st-ok)]",
  wait: "text-[var(--st-wait)]",
  bad: "text-[var(--st-bad)]",
};

function toneFor(triggered: boolean, approaching: boolean): Tone {
  if (triggered) return "bad";
  if (approaching) return "wait";
  return "ok";
}

function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  if (tone === "bad")
    return <WarningOctagonIcon weight="fill" className={className} />;
  if (tone === "wait")
    return <WarningCircleIcon weight="fill" className={className} />;
  return <CheckCircleIcon weight="fill" className={className} />;
}

interface ProcessDriftWarningsProps {
  processId: string;
  /** Gate the query — pass the panel's open state so it fires only when shown. */
  enabled?: boolean;
}

export function ProcessDriftWarnings({
  processId,
  enabled = true,
}: ProcessDriftWarningsProps) {
  const { data, isLoading, error } = useProcessComplianceDrift(
    processId,
    undefined,
    enabled,
  );

  if (isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Checking compliance drift…
      </p>
    );
  }
  if (error) {
    return (
      <p className="body-small text-[var(--st-bad)]">
        {error.message || "Could not evaluate compliance drift."}
      </p>
    );
  }
  if (!data) return null;

  const { drift, windowMonths } = data;
  const headlineTone: Tone = drift.anyTriggered
    ? "bad"
    : drift.anyApproaching
      ? "wait"
      : "ok";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-8">
        <ToneIcon
          tone={headlineTone}
          className={cn("shrink-0", TONE_INK[headlineTone])}
        />
        <p className="flex items-center gap-6 body-small-bold text-[var(--color-text-primary)]">
          {drift.anyTriggered
            ? "An Isometric review trigger has been reached"
            : drift.anyApproaching
              ? "Approaching an Isometric review trigger"
              : "No compliance drift detected"}
          <InfoHint label="About compliance drift">
            Rolling {windowMonths}-month window. noma warns only — the registry
            is the detector of record; the remedy is to start a new production
            process.
          </InfoHint>
        </p>
      </div>

      <MissedSamplingsRow result={drift.missedSamplings} />
      <SubThreeSigmaRow result={drift.subThreeSigma} />
    </div>
  );
}

function CounterRow({
  tone,
  title,
  metric,
  detail,
}: {
  tone: Tone;
  title: string;
  metric: string;
  detail: string;
}) {
  // OK counters stay quiet — a plain row, no colored box — so only an
  // approaching/triggered counter draws the eye. The longer explanation moves
  // to an ⓘ hover rather than always occupying a line.
  const emphasised = tone !== "ok";
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-8",
        emphasised ? cn("border p-12", TONE_BOX[tone]) : "px-2",
      )}
    >
      <span className="flex items-center gap-6 body-small font-medium text-[var(--color-text-primary)]">
        <ToneIcon tone={tone} className={cn("shrink-0", TONE_INK[tone])} />
        {title}
        <InfoHint label={title}>{detail}</InfoHint>
      </span>
      <span
        className={cn("body-small tabular-nums font-medium", TONE_INK[tone])}
      >
        {metric}
      </span>
    </div>
  );
}

function MissedSamplingsRow({ result }: { result: MissedSamplingsResult }) {
  const tone = toneFor(result.triggered, result.approaching);
  return (
    <CounterRow
      tone={tone}
      title="Missed required samplings"
      metric={`${result.missedCount} / ${result.trigger}`}
      detail={
        result.triggered
          ? `${result.missedCount} missed in the window — at or above the review trigger of ${result.trigger}.`
          : result.approaching
            ? `${result.missedCount} missed — one more reaches the review trigger of ${result.trigger}.`
            : `${result.sampledBatches}/${result.requiredSampledBatches} required batches sampled in the window.`
      }
    />
  );
}

function SubThreeSigmaRow({ result }: { result: SubThreeSigmaResult }) {
  const tone = toneFor(result.triggered, result.approaching);
  // The 3σ rule only applies once the pool is deep enough; below that there is
  // nothing to warn about (registry remains the authority on a thin pool).
  const detail = !result.applies
    ? result.notes[0] ??
      "Not enough measurements in the window for the 3σ outlier check yet."
    : result.triggered
      ? `${result.belowCount} below the 3σ lower bound — past the review trigger of ${result.trigger}.`
      : result.approaching
        ? `${result.belowCount} below the 3σ lower bound — one more would breach the trigger of ${result.trigger}.`
        : `${result.belowCount} of ${result.measurementCount} measurements below the 3σ lower bound.`;

  return (
    <CounterRow
      tone={result.applies ? tone : "ok"}
      title="Sub-3σ carbon measurements"
      metric={result.applies ? `${result.belowCount} / ${result.trigger}` : "—"}
      detail={detail}
    />
  );
}
