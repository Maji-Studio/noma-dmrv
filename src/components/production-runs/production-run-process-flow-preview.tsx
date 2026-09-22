/**
 * The run as a journey: where the material came from, what it passed through,
 * where it ended up.
 *
 * Three stops on a rail, source bins to reactor to destination bin, and the two
 * segments between them carry the masses. The first segment is the feedstock
 * going in, drawn as its moisture split so the dry matter the yield is measured
 * on is visible rather than implied. The second is the biochar coming out, the
 * same way, with the dry-basis yield as the one headline figure of the block.
 *
 * It replaces a three-box recap that read as three unrelated cards: a run is a
 * sequence, so it is drawn as one, and it reuses the transport journey's shape
 * (nodes on a rail, the leg boxed between them) because an operator has already
 * learnt to read that on the delivery and sample sheets.
 *
 * Simple keeps the rail, the two masses and the yield, because that is what the
 * fields it derives from mean. Detailed adds the yield arithmetic. Both bases
 * are honest: when either dry mass is missing the whole equation falls back to
 * wet mass and says so in the yield's own label, rather than mixing a dry
 * numerator with a wet denominator. The segment whose dry mass is missing
 * already carries the unresolved split bar naming the field to fill.
 */
"use client";

import type { ReactNode } from "react";
import { CompositionCard } from "@/components/forms/composition-card";
import { useFormDetailLevel } from "@/components/forms/form-detail-context";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { formatMassKg, formatPercent } from "@/lib/format-utils";
import { PERCENT_SCALE } from "@/lib/mass-moisture";
import { StockRows, type StockRow } from "@/components/storage-locations/stock-figures";

const YIELD_DIGITS = 1;

const PROCESS_FLOW_HINT =
  "Yield is the biochar leaving the reactor as a share of the feedstock entering it. Dry mass is the basis carbon accounting uses.";

interface ProcessFlowProps {
  sourceBinName: string | null;
  feedstockKg: number | null;
  feedstockMoisturePercent: number | null;
  feedstockDryKg: number | null;
  reactorName: string | null;
  biocharKg: number | null;
  biocharMoisturePercent: number | null;
  biocharDryKg: number | null;
  destinationBinName: string | null;
}

/** One basis for the whole equation: dry whenever both dry masses resolve. */
interface FlowBasis {
  dry: boolean;
  feedstockKg: number | null;
  biocharKg: number | null;
  yieldPercent: number | null;
}

function resolveBasis({ feedstockKg, feedstockDryKg, biocharKg, biocharDryKg }: ProcessFlowProps): FlowBasis {
  const dry = feedstockDryKg !== null && biocharDryKg !== null;
  const input = dry ? feedstockDryKg : feedstockKg;
  const output = dry ? biocharDryKg : biocharKg;
  return {
    dry,
    feedstockKg: input,
    biocharKg: output,
    yieldPercent: input !== null && input > 0 && output !== null ? (output / input) * PERCENT_SCALE : null,
  };
}

export function ProcessFlowPreview(props: ProcessFlowProps) {
  const {
    sourceBinName,
    feedstockKg,
    feedstockMoisturePercent,
    feedstockDryKg,
    reactorName,
    biocharKg,
    biocharMoisturePercent,
    biocharDryKg,
    destinationBinName,
  } = props;
  const detailed = useFormDetailLevel() === "detailed";
  if (!sourceBinName && !reactorName && !destinationBinName) return null;
  const basis = resolveBasis(props);
  const yieldLabel = `${basis.dry ? "Dry" : "Wet"} yield`;

  return (
    <CompositionCard
      title="Process flow"
      hint={PROCESS_FLOW_HINT}
      calculation={detailed && basis.yieldPercent !== null ? <YieldCalculation basis={basis} label={yieldLabel} /> : undefined}
    >
      {/* The block's own section already carries the name. */}
      <ol>
        <FlowStop name={sourceBinName} placeholder="Select source bin">
          <FlowSegment
            label="Feedstock in"
            massKg={feedstockKg}
            moisturePercent={feedstockMoisturePercent}
            dryMassKg={feedstockDryKg}
            materialLabel="Feedstock"
          />
        </FlowStop>
        <FlowStop name={reactorName} placeholder="Select reactor">
          <FlowSegment
            label="Biochar out"
            massKg={biocharKg}
            moisturePercent={biocharMoisturePercent}
            dryMassKg={biocharDryKg}
            materialLabel="Biochar"
            figure={basis.yieldPercent === null ? undefined : { label: yieldLabel, value: formatPercent(basis.yieldPercent, { digits: YIELD_DIGITS }) }}
          />
        </FlowStop>
        <FlowStop name={destinationBinName} placeholder="Select destination bin" />
      </ol>
    </CompositionCard>
  );
}

/**
 * A stop on the rail: the node, the line down to the next stop, the stop's name
 * and the segment leaving it. The final stop has no segment, so it has no line.
 *
 * An unselected stop still gets a node. The rail is the shape of a run whether
 * or not its bins are picked yet, and the placeholder says which field to fill.
 */
function FlowStop({ name, placeholder, children }: { name: string | null; placeholder: string; children?: ReactNode }) {
  return (
    <li className="flex gap-12">
      <div className="flex flex-col items-center" aria-hidden="true">
        <span className="mt-6 size-8 shrink-0 rounded-full bg-[var(--color-text-primary)]" />
        {children && <span className="w-1 flex-1 bg-[var(--color-border-secondary)]" />}
      </div>
      <div className={`min-w-0 flex-1 space-y-8 ${children ? "pb-16" : ""}`}>
        <p className={`body-small font-medium ${name ? "" : "text-[var(--color-text-tertiary)]"}`}>{name ?? placeholder}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * The boxed segment between two stops: what travelled it, how much of it, and
 * the split between the dry matter and the water. The mass stays pinned right
 * against the wrapping label, the way a transport leg pins its distance.
 */
function FlowSegment({ label, massKg, moisturePercent, dryMassKg, materialLabel, figure }: {
  label: string;
  massKg: number | null;
  moisturePercent: number | null;
  dryMassKg: number | null;
  materialLabel: string;
  /** The one headline figure this segment carries, such as the run's yield. */
  figure?: { label: string; value: string };
}) {
  return (
    <div className="space-y-8 border border-[var(--color-border-tertiary)] p-8">
      <div className="flex items-baseline justify-between gap-8">
        <p className="body-small text-[var(--color-text-secondary)]">{label}</p>
        {/* No mass yet means no figure: the split bar below already names the
            field that is missing, and "Not recorded wet" reads as a value. */}
        {massKg !== null && <span className="shrink-0 body-small font-medium tabular-nums">{formatMassKg(massKg)} wet</span>}
      </div>
      <MoistureSplit calculation={false} wetMassKg={massKg} moisturePercent={moisturePercent} dryMassKg={dryMassKg} materialLabel={materialLabel} />
      {figure && (
        <div className="space-y-2">
          <span className="block body-caption text-[var(--color-text-secondary)]">{figure.label}</span>
          <span className="block body-large font-medium tabular-nums">{figure.value}</span>
        </div>
      )}
    </div>
  );
}

/** The yield in words and then with this run's figures, so it can be checked. */
function YieldCalculation({ basis, label }: { basis: FlowBasis; label: string }) {
  const material = basis.dry ? "Dry" : "Wet";
  const rows: StockRow[] = [
    { label: `${material} feedstock in`, value: formatMassKg(basis.feedstockKg) },
    { label: `${material} biochar out`, value: formatMassKg(basis.biocharKg) },
    { label, value: formatPercent(basis.yieldPercent, { digits: YIELD_DIGITS }) },
  ];
  return (
    <div className="space-y-8">
      <StockRows label="Figures behind the yield" rows={rows} />
      <p className="body-caption text-[var(--color-text-tertiary)]">
        {`${label} = biochar out / feedstock in. ${formatMassKg(basis.biocharKg)} / ${formatMassKg(basis.feedstockKg)} = ${formatPercent(basis.yieldPercent, { digits: YIELD_DIGITS })}.`}
      </p>
    </div>
  );
}
