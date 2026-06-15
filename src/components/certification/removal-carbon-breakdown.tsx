/**
 * RemovalCarbonBreakdown — the carbon-accounting card in the removal detail
 * sheet. It tells the same story the Isometric registry tells for a GHG entry:
 *
 *     Sequestrations  −  Activities  −  Uncertainty discount  =  Net CO₂e removed
 *
 * rendered as a single deduction bar (how much of the gross sequestration
 * survives as net) over a signed ledger ending in the emphasised net. A
 * submitted removal shows the registry's verified figures (with the uncertainty
 * haircut made explicit and the buffer-pool split); a draft shows an honest
 * local estimate with the uncertainty step greyed out until verification.
 *
 * All numbers and the source/reconciliation flags come from the pure
 * `computeRemovalBreakdown` (see `@/lib/certification/removal-breakdown`); this
 * component only chooses which story to render and how to draw it.
 */
"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  ArrowDown,
  Leaf,
  SealCheck,
  SlidersHorizontal,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { InfoHint } from "@/components/ui/tooltip";
import { useRemovalBreakdown } from "@/hooks/use-certification";
import type { RemovalBreakdownData } from "@/fn/certification";
import { formatCo2e } from "@/lib/format-utils";
import { cn } from "@/lib/utils";

interface RemovalCarbonBreakdownProps {
  removalId: string;
  /** Gate the fetch — the sheet only enables it while open. */
  enabled?: boolean;
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
          <InfoHint side="top" size={13}>
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
          <SealCheck size={13} weight="fill" aria-hidden />
        ) : (
          <SlidersHorizontal size={13} weight="bold" aria-hidden />
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

function Body({ data }: { data: RemovalBreakdownData }) {
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
          Carbon figures appear once this removal&apos;s credit batches have
          complete data.
        </p>
        {missingInputs.length > 0 && (
          <MissingInputs inputs={missingInputs} />
        )}
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
          A net estimate needs every member batch&apos;s stored-carbon inputs.
        </p>
        <MissingInputs inputs={missingInputs} />
      </Shell>
    );
  }

  // The full three-step waterfall — the gross is known and (for submitted
  // removals) reconciles with the registry's verified pre-uncertainty figure.
  const fullWaterfall =
    sequestrationKg != null && (isEstimate || reconciles);

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
          bufferPoolPercent={bufferPoolPercent}
          bufferCreditsKg={bufferCreditsKg}
          standardDeviationKg={standardDeviationKg}
        />
      </Shell>
    );
  }

  // Registry-only path: the verified GHG entry exists but the local gross is
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
          <Warning
            size={13}
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
      <ArrowDown
        size={13}
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
  bufferPoolPercent,
  bufferCreditsKg,
  standardDeviationKg,
}: {
  isEstimate: boolean;
  bufferPoolPercent: number | null;
  bufferCreditsKg: number | null;
  standardDeviationKg: number | null;
}) {
  if (isEstimate) {
    return (
      <p className="flex items-start gap-6 body-caption text-[var(--color-text-tertiary)]">
        <Leaf size={13} weight="fill" aria-hidden className="mt-2 shrink-0" />
        <span>
          The uncertainty discount and final net are set when Isometric verifies
          this removal.
        </span>
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
      <SealCheck
        size={13}
        weight="fill"
        aria-hidden
        className="mt-2 shrink-0 text-[var(--color-signal-green)]"
      />
      <span>{parts.join(" · ")}</span>
    </p>
  );
}

function LoadingState() {
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

export function RemovalCarbonBreakdown({
  removalId,
  enabled = true,
}: RemovalCarbonBreakdownProps) {
  const { data, isLoading, isError } = useRemovalBreakdown(removalId, enabled);

  if (isLoading) return <LoadingState />;
  // A breakdown is supplementary — if it can't load, the sheet's other
  // sections still do their job, so fail quiet rather than block the view.
  if (isError || !data) return null;

  return <Body data={data} />;
}
