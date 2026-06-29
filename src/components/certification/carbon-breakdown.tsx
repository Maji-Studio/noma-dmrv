/**
 * Carbon-accounting breakdown card — the shared presentation behind both the
 * removal detail sheet's breakdown and the GHG-statement detail sheet's
 * roll-up. It tells the Isometric registry's story:
 *
 *     Sequestrations  −  Activities  −  Uncertainty discount  =  Net CO₂e removed
 *
 * rendered as a single deduction bar (how much of the gross sequestration
 * survives as net) over a signed ledger ending in the emphasised net. A
 * verified record shows the registry's figures (with the uncertainty haircut
 * made explicit and the buffer-pool split); a draft shows an honest local
 * estimate with the uncertainty step greyed out until verification.
 *
 * All numbers and the source/reconciliation flags come from the pure
 * `computeRemovalBreakdown` / `computeGhgStatementBreakdown`; this component
 * only chooses which story to render and how to draw it. The two entry points
 * (removal, statement) differ only in a few copy strings, supplied as
 * `CarbonBreakdownLabels` — keeping one card means the two surfaces can't
 * drift visually.
 */
"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  ArrowDownIcon,
  LeafIcon,
  SealCheckIcon,
  SlidersHorizontalIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { InfoHint } from "@/components/ui/tooltip";
import type { RemovalCarbonBreakdown } from "@/lib/certification/removal-breakdown";
import { formatCo2e } from "@/lib/format-utils";
import { cn } from "@/lib/utils";

// The copy that differs between the removal card and the statement roll-up.
// Everything else (the bar, the ledger, the hints) is identical.
export interface CarbonBreakdownLabels {
  /** Empty state — no computable local preview and no registry figures. */
  noData: string;
  /** Estimate path where the gross can't be summed (incomplete previews). */
  estimateIncomplete: string;
  /** Estimate footnote — who sets the uncertainty discount and final net. */
  estimateFootnote: string;
}

// Every figure shares one visual language across the bar and the ledger: a
// stored/net green, a deduction orange for emissions, a softer orange for the
// counterfactual, and a hatched neutral for the statistical uncertainty haircut.
type Tone = "stored" | "activity" | "counterfactual" | "uncertainty" | "net";

// The diagonal hatch is an inline style, not a Tailwind arbitrary gradient:
// complex gradient utilities born in a new file can be missed by a
// long-running dev server's class scan and silently render flat, so the
// uncertainty fill carries its own background-image.
const UNCERTAINTY_STYLE: CSSProperties = {
  backgroundColor: "var(--color-surface-medium)",
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--color-text-tertiary) 0, var(--color-text-tertiary) 1px, transparent 1px, transparent 5px)",
};
const MICRO_ICON_SIZE = 13;

const TONE_CLASS: Record<Tone, string> = {
  stored: "bg-[var(--color-signal-green)]",
  net: "bg-[var(--color-signal-green)]",
  activity: "bg-[var(--color-signal-orange)]",
  counterfactual: "bg-[var(--color-signal-orange-light)]",
  uncertainty: "",
};

function toneStyle(tone: Tone): CSSProperties | undefined {
  return tone === "uncertainty" ? UNCERTAINTY_STYLE : undefined;
}

interface Segment {
  tone: Tone;
  kg: number;
}

/**
 * The deduction bar: segments whose widths are shares of `totalKg`. The net
 * sits first (the green that survives), deductions follow — so the eye reads
 * left-to-right how the gross is whittled down.
 */
function DeductionBar({
  segments,
  totalKg,
}: {
  segments: Segment[];
  totalKg: number;
}) {
  const safeTotal = totalKg > 0 ? totalKg : 1;
  return (
    <div
      className="flex h-10 w-full gap-[2px] overflow-hidden bg-[var(--color-surface-light)]"
      aria-hidden
    >
      {segments
        .filter((s) => s.kg > 0)
        .map((segment, i) => (
          <div
            key={`${segment.tone}-${i}`}
            className={cn("h-full min-w-[3px]", TONE_CLASS[segment.tone])}
            style={{
              width: `${(segment.kg / safeTotal) * 100}%`,
              ...toneStyle(segment.tone),
            }}
          />
        ))}
    </div>
  );
}

function Swatch({ tone }: { tone: Tone }) {
  return (
    <span
      className={cn("mt-[3px] inline-block h-10 w-10 shrink-0", TONE_CLASS[tone])}
      style={toneStyle(tone)}
      aria-hidden
    />
  );
}

/** One signed ledger line: swatch · label (+ optional hint) · value. */
function LedgerRow({
  tone,
  label,
  hint,
  value,
  muted = false,
  emphasised = false,
}: {
  tone: Tone;
  label: string;
  hint?: ReactNode;
  value: ReactNode;
  muted?: boolean;
  emphasised?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-12",
        emphasised && "pt-10 border-t border-[var(--color-border-primary)]",
      )}
    >
      <span className="flex items-baseline gap-8 min-w-0">
        <Swatch tone={tone} />
        <span
          className={cn(
            emphasised
              ? "body-small font-medium text-[var(--color-text-primary)]"
              : "body-small text-[var(--color-text-secondary)]",
            muted && "text-[var(--color-text-tertiary)]",
          )}
        >
          {label}
        </span>
        {hint && (
          <InfoHint side="top" size={MICRO_ICON_SIZE}>
            {hint}
          </InfoHint>
        )}
      </span>
      <span
        className={cn(
          "tabular-nums tracking-tight whitespace-nowrap",
          emphasised
            ? "title-heading-3 text-[var(--color-text-primary)]"
            : "body-small text-[var(--color-text-primary)]",
          muted && "body-small font-normal text-[var(--color-text-tertiary)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-16 border border-[var(--color-border-primary)] bg-[var(--color-surface-light)] px-16 py-16">
      {children}
    </section>
  );
}

function Eyebrow({ source }: { source: "registry" | "estimate" }) {
  const verified = source === "registry";
  return (
    <div className="flex items-center justify-between gap-12">
      <span className="label-micro text-[var(--color-text-secondary)]">
        Carbon accounting
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-4 px-6 py-2 body-caption-fit font-medium uppercase tracking-wide",
          verified
            ? "bg-[var(--st-ok-bg)] text-[var(--color-signal-green)]"
            : "bg-[var(--color-background-medium)] text-[var(--color-text-secondary)]",
        )}
      >
        {verified ? (
          <SealCheckIcon size={MICRO_ICON_SIZE} weight="fill" aria-hidden />
        ) : (
          <SlidersHorizontalIcon size={MICRO_ICON_SIZE} weight="bold" aria-hidden />
        )}
        {verified ? "Registry-verified" : "Estimate"}
      </span>
    </div>
  );
}

function Hero({
  netKg,
  approximate,
}: {
  netKg: number | null;
  approximate: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="title-heading-2 tabular-nums tracking-tight text-[var(--color-text-primary)]">
        {approximate && netKg != null && (
          <span className="text-[var(--color-text-tertiary)]">≈ </span>
        )}
        {formatCo2e(netKg)}
      </span>
      <span className="body-caption text-[var(--color-text-tertiary)]">
        Net CO₂e removed{approximate ? " · before verification" : " · verified"}
      </span>
    </div>
  );
}

// ---- Hints (kept terse; the ⓘ replaces verbose helper prose) ---------------

const HINT_SEQUESTRATION =
  "Gross CO₂e durably stored in the applied biochar, before any deductions.";
const HINT_ACTIVITIES =
  "Project emissions from the removal activity — pyrolysis energy, transport and handling.";
const HINT_COUNTERFACTUAL =
  "Baseline emissions that would have occurred without the removal.";
const HINT_UNCERTAINTY =
  "A statistical haircut Isometric applies to account for measurement uncertainty.";

function CarbonBreakdownBody({
  data,
  labels,
}: {
  data: RemovalCarbonBreakdown;
  labels: CarbonBreakdownLabels;
}) {
  const {
    source,
    sequestrationKg,
    activitiesKg,
    activitiesRecorded,
    counterfactualKg,
    counterfactualRecorded,
    uncertaintyDiscountKg,
    standardDeviationKg,
    netRemovedKg,
    netBeforeDiscountKg,
    reconciles,
    bufferPoolPercent,
    bufferCreditsKg,
    missingInputs,
  } = data;

  const isEstimate = source === "estimate";

  // Nothing computable yet — neither a complete local preview nor registry data.
  if (!data.hasAnyData) {
    return (
      <Shell>
        <Eyebrow source={source} />
        <p className="body-small text-[var(--color-text-tertiary)]">
          {labels.noData}
        </p>
        {missingInputs.length > 0 && <MissingInputs inputs={missingInputs} />}
      </Shell>
    );
  }

  // Estimate path where the gross can't be summed (incomplete previews): show
  // what's known and point at the gap rather than a misleading net.
  if (isEstimate && sequestrationKg == null) {
    return (
      <Shell>
        <Eyebrow source={source} />
        <p className="body-small text-[var(--color-text-secondary)]">
          {labels.estimateIncomplete}
        </p>
        <MissingInputs inputs={missingInputs} />
      </Shell>
    );
  }

  // The full three-step waterfall — the gross is known and (for verified
  // records) reconciles with the registry's verified pre-uncertainty figure.
  const fullWaterfall = sequestrationKg != null && (isEstimate || reconciles);

  if (fullWaterfall && sequestrationKg != null) {
    const segments: Segment[] = [
      { tone: "net", kg: netRemovedKg ?? 0 },
      { tone: "counterfactual", kg: counterfactualKg },
      { tone: "activity", kg: activitiesKg },
      { tone: "uncertainty", kg: uncertaintyDiscountKg ?? 0 },
    ];
    return (
      <Shell>
        <Eyebrow source={source} />
        <Hero netKg={netRemovedKg} approximate={isEstimate} />
        <DeductionBar segments={segments} totalKg={sequestrationKg} />
        <div className="flex flex-col gap-10">
          <LedgerRow
            tone="stored"
            label="Sequestrations"
            hint={HINT_SEQUESTRATION}
            value={formatCo2e(sequestrationKg)}
          />
          <LedgerRow
            tone="activity"
            label="Activities"
            hint={HINT_ACTIVITIES}
            value={
              activitiesRecorded ? (
                `− ${formatCo2e(activitiesKg)}`
              ) : (
                <span className="text-[var(--color-text-tertiary)]">
                  Not recorded
                </span>
              )
            }
            muted={!activitiesRecorded}
          />
          {counterfactualRecorded && (
            <LedgerRow
              tone="counterfactual"
              label="Counterfactual"
              hint={HINT_COUNTERFACTUAL}
              value={`− ${formatCo2e(counterfactualKg)}`}
            />
          )}
          <LedgerRow
            tone="uncertainty"
            label="Uncertainty discount"
            hint={HINT_UNCERTAINTY}
            value={
              isEstimate ? (
                <span className="text-[var(--color-text-tertiary)]">
                  At verification
                </span>
              ) : (
                `− ${formatCo2e(uncertaintyDiscountKg)}`
              )
            }
            muted={isEstimate}
          />
          <LedgerRow
            tone="net"
            label="Net CO₂e removed"
            value={formatCo2e(netRemovedKg)}
            emphasised
          />
        </div>
        <Footnotes
          isEstimate={isEstimate}
          estimateFootnote={labels.estimateFootnote}
          bufferPoolPercent={bufferPoolPercent}
          bufferCreditsKg={bufferCreditsKg}
          standardDeviationKg={standardDeviationKg}
        />
      </Shell>
    );
  }

  // Registry-only path: the verified figures exist but the local gross is
  // missing or diverges. Anchor the bar on the registry's pre-uncertainty
  // figure so the math always adds up; surface local inputs only as context.
  const segments: Segment[] = [
    { tone: "net", kg: netRemovedKg ?? 0 },
    { tone: "uncertainty", kg: uncertaintyDiscountKg ?? 0 },
  ];
  return (
    <Shell>
      <Eyebrow source={source} />
      <Hero netKg={netRemovedKg} approximate={false} />
      <DeductionBar segments={segments} totalKg={netBeforeDiscountKg ?? 0} />
      <div className="flex flex-col gap-10">
        <LedgerRow
          tone="stored"
          label="Net before uncertainty"
          value={formatCo2e(netBeforeDiscountKg)}
        />
        <LedgerRow
          tone="uncertainty"
          label="Uncertainty discount"
          hint={HINT_UNCERTAINTY}
          value={`− ${formatCo2e(uncertaintyDiscountKg)}`}
        />
        <LedgerRow
          tone="net"
          label="Net CO₂e removed"
          value={formatCo2e(netRemovedKg)}
          emphasised
        />
      </div>
      {sequestrationKg != null && (
        <p className="flex items-start gap-6 body-caption text-[var(--color-text-tertiary)]">
          <WarningIcon
            size={MICRO_ICON_SIZE}
            weight="fill"
            aria-hidden
            className="mt-2 shrink-0 text-[var(--color-signal-orange)]"
          />
          <span>
            Your inputs (Sequestrations {formatCo2e(sequestrationKg)}, Activities{" "}
            {formatCo2e(activitiesKg)}) differ from the registry&apos;s verified
            figures — the registry net is authoritative.
          </span>
        </p>
      )}
      <Footnotes
        isEstimate={false}
        estimateFootnote={labels.estimateFootnote}
        bufferPoolPercent={bufferPoolPercent}
        bufferCreditsKg={bufferCreditsKg}
        standardDeviationKg={standardDeviationKg}
      />
    </Shell>
  );
}

function MissingInputs({ inputs }: { inputs: string[] }) {
  return (
    <p className="flex items-start gap-6 body-caption text-[var(--color-text-tertiary)]">
      <ArrowDownIcon
        size={MICRO_ICON_SIZE}
        weight="bold"
        aria-hidden
        className="mt-2 shrink-0 rotate-[-45deg] text-[var(--color-text-tertiary)]"
      />
      <span>Awaiting: {inputs.join(", ")}</span>
    </p>
  );
}

function Footnotes({
  isEstimate,
  estimateFootnote,
  bufferPoolPercent,
  bufferCreditsKg,
  standardDeviationKg,
}: {
  isEstimate: boolean;
  estimateFootnote: string;
  bufferPoolPercent: number | null;
  bufferCreditsKg: number | null;
  standardDeviationKg: number | null;
}) {
  if (isEstimate) {
    return (
      <p className="flex items-start gap-6 body-caption text-[var(--color-text-tertiary)]">
        <LeafIcon size={MICRO_ICON_SIZE} weight="fill" aria-hidden className="mt-2 shrink-0" />
        <span>{estimateFootnote}</span>
      </p>
    );
  }
  const parts: string[] = [];
  if (bufferPoolPercent != null) {
    parts.push(`Buffer pool ${bufferPoolPercent}%`);
    if (bufferCreditsKg != null) {
      parts.push(`${formatCo2e(bufferCreditsKg)} held back`);
    }
  }
  if (standardDeviationKg != null) {
    parts.push(`±${formatCo2e(standardDeviationKg)} std. dev.`);
  }
  if (parts.length === 0) return null;
  return (
    <p className="flex items-start gap-6 body-caption text-[var(--color-text-tertiary)]">
      <SealCheckIcon
        size={MICRO_ICON_SIZE}
        weight="fill"
        aria-hidden
        className="mt-2 shrink-0 text-[var(--color-signal-green)]"
      />
      <span>{parts.join(" · ")}</span>
    </p>
  );
}

/** Shared loading skeleton — mirrors the card's eyebrow · hero · bar · ledger. */
export function CarbonBreakdownSkeleton() {
  return (
    <Shell>
      <div className="flex items-center justify-between">
        <Skeleton width={120} height={12} />
        <Skeleton width={88} height={18} />
      </div>
      <Skeleton width={140} height={30} />
      <Skeleton width="100%" height={10} />
      <div className="flex flex-col gap-10">
        {[64, 56, 72].map((w) => (
          <div key={w} className="flex items-center justify-between">
            <Skeleton width={w + 40} height={12} />
            <Skeleton width={w} height={12} />
          </div>
        ))}
      </div>
    </Shell>
  );
}

/**
 * The breakdown card. Accepts any computed breakdown (a removal's or a
 * statement's roll-up — both are `RemovalCarbonBreakdown`) plus the surface's
 * copy. Fetching and loading/error gating live in the per-surface wrappers.
 */
export function CarbonBreakdownCard({
  data,
  labels,
}: {
  data: RemovalCarbonBreakdown;
  labels: CarbonBreakdownLabels;
}) {
  return <CarbonBreakdownBody data={data} labels={labels} />;
}
