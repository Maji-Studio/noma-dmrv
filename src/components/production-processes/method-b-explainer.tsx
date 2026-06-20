/**
 * MethodBExplainer — the persistent, protocol-cited explanation surface for the
 * Method-B unlock (ADR 0017 Track 2, item 3 / D5).
 *
 * Method B replaces per-batch sampling with a conservative estimate the REGISTRY
 * computes from the eligible-sample pool (ADR 0013 / D1). Three prerequisites a
 * sample count cannot infer must be agreed with Isometric at unlock; this surface
 * explains *why* each exists so the operator captures them deliberately.
 *
 * Shown ONLY when the facility has an Isometric registry link (D5) — the
 * prerequisites are Isometric-agreement declarations. The caller resolves that
 * from `useFacilityCertifierSummary` (registry-gating) and gates rendering.
 *
 * Non-authoritative summary — verify against the linked protocol modules before
 * relying on it for credit claims. Pure presentational, client-safe.
 */
"use client";

import { Info } from "@phosphor-icons/react";
import {
  METHOD_B_MINIMUM_METHOD_A_SAMPLES,
  METHOD_B_SAMPLING_CADENCE_BATCHES,
} from "@/config/certification";
import { InfoHint } from "@/components/ui/tooltip";

interface PrerequisiteCopy {
  /** Protocol reference code (Isometric condition registry). */
  ref: string;
  title: string;
  body: string;
}

const PREREQUISITES: PrerequisiteCopy[] = [
  {
    ref: "G-F74T-0",
    title: "Agreed baseline size",
    body: `At least ${METHOD_B_MINIMUM_METHOD_A_SAMPLES} prior Method-A replicate samples must characterise this production process before its variability is known well enough to estimate unsampled batches. The agreed size is the count Isometric signs off on — never below the ${METHOD_B_MINIMUM_METHOD_A_SAMPLES}-sample protocol floor.`,
  },
  {
    ref: "R-S8K1-1",
    title: "Random-sampling plan",
    body: `Under Method B you sample at least 1 batch per ${METHOD_B_SAMPLING_CADENCE_BATCHES}. Which batches get sampled must follow a documented random plan agreed in advance, so the ongoing pool stays representative rather than hand-picked.`,
  },
  {
    ref: "R-ADXG-0",
    title: "Moisture-determination pathway",
    body: "The conservative carbon estimate is on a dry-mass basis, so the protocol fixes how moisture is determined for every batch. Recording the agreed pathway keeps the unsampled estimate comparable to the sampled measurements behind it.",
  },
];

/**
 * Shared intro — why the three prerequisites exist. Rendered inline in the full
 * variant; carried by the title's ⓘ tooltip in the compact one.
 */
const INTRO =
  "Method B credits unsampled batches from a conservative, registry-computed estimate (μ − σ/√n). These prerequisites are agreed with Isometric — a sample count alone can't infer them.";

interface MethodBExplainerProps {
  /**
   * Heading rendered above the prerequisites. Defaults to a panel-style title;
   * pass a tighter one inside the unlock dialog.
   */
  title?: string;
  /**
   * Compact mode (process detail panel): collapse the intro + each prerequisite
   * body into ⓘ hover tooltips so only the agreement names occupy layout. The
   * full variant (unlock dialog) keeps the prose visible — that's the deliberate
   * decision moment. Defaults to the full variant.
   */
  compact?: boolean;
}

export function MethodBExplainer({
  title = "Why Method B needs these three agreements",
  compact = false,
}: MethodBExplainerProps) {
  if (compact) {
    return (
      <div className="flex flex-col gap-8 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] p-12">
        <p className="flex items-center gap-6 body-small-bold text-[var(--color-text-primary)]">
          Method B — agreements with Isometric
          <InfoHint label="Why Method B needs these agreements">{INTRO}</InfoHint>
        </p>
        <ul className="flex flex-col gap-6">
          {PREREQUISITES.map((item) => (
            <li
              key={item.ref}
              className="flex items-center gap-6 body-small text-[var(--color-text-secondary)]"
            >
              <span
                aria-hidden
                className="size-[5px] shrink-0 bg-[var(--st-run)]"
              />
              <span className="truncate">{item.title}</span>
              <span className="shrink-0 border border-[var(--color-border-tertiary)] px-6 py-1 body-caption font-mono text-[var(--color-text-tertiary)]">
                {item.ref}
              </span>
              <InfoHint label={item.title}>{item.body}</InfoHint>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] p-16">
      <div className="flex items-start gap-8">
        <Info
          size={16}
          weight="bold"
          className="mt-2 shrink-0 text-[var(--st-run)]"
        />
        <div className="flex flex-col gap-2">
          <p className="body-small-bold text-[var(--color-text-primary)]">
            {title}
          </p>
          <p className="body-caption text-[var(--color-text-tertiary)]">
            {INTRO}
          </p>
        </div>
      </div>

      <dl className="flex flex-col gap-12">
        {PREREQUISITES.map((item) => (
          <div key={item.ref} className="flex flex-col gap-2">
            <dt className="flex items-center gap-8 body-small font-medium text-[var(--color-text-secondary)]">
              {item.title}
              <span className="border border-[var(--color-border-tertiary)] px-6 py-1 body-caption font-mono text-[var(--color-text-tertiary)]">
                {item.ref}
              </span>
            </dt>
            <dd className="body-caption text-[var(--color-text-tertiary)]">
              {item.body}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
