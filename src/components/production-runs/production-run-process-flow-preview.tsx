/**
 * The run as a journey: where the material came from, what it passed through,
 * where it ended up.
 *
 * Three stops, source bins to reactor to destination bin, and the two
 * segments between them carry the masses. The first segment is the feedstock
 * going in, drawn as its moisture split so the dry matter the yield is measured
 * on is visible rather than implied. The second is the biochar coming out, the
 * same way. The yield is the block's one headline figure, above the stops.
 *
 * The two bars share one mass scale: the heavier wet mass fills the row and
 * the other is drawn in proportion, so 1,000 kg in and 300 kg out look like it.
 * There is no rail: the section spine around the block is already a timeline,
 * and a second one beside it read as two competing sequences. The order of the
 * stops and their names carry the sequence.
 *
 * Both levels show the yield headline and the stops. Detailed adds only the
 * yield arithmetic behind Show calculation. Both bases
 * are honest: when either dry mass is missing the whole equation falls back to
 * wet mass and says so in the yield's own label, rather than mixing a dry
 * numerator with a wet denominator. The segment whose dry mass is missing
 * already carries the unresolved split bar naming the field to fill.
 */
"use client";

import type { ReactNode } from "react";
import { CompositionCard } from "@/components/forms/composition-card";
import { DerivedHeadline } from "@/components/forms/derived-headline";
import { flowBarWidthPercent, flowScaleKg } from "./production-run-flow-scale";
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
  if (!sourceBinName && !reactorName && !destinationBinName) return null;
  const basis = resolveBasis(props);
  // Until a yield resolves there is no basis to name, only the figure missing.
  const yieldLabel = basis.yieldPercent === null ? "Yield" : `${basis.dry ? "Dry" : "Wet"} yield`;
  const scaleKg = flowScaleKg(feedstockKg, biocharKg);

  return (
    <CompositionCard
      title="Process flow"
      hint={PROCESS_FLOW_HINT}
      headline={<DerivedHeadline
        label={yieldLabel}
        value={basis.yieldPercent === null ? null : formatPercent(basis.yieldPercent, { digits: YIELD_DIGITS })}
      />}
      calculation={basis.yieldPercent !== null ? <YieldCalculation basis={basis} label={yieldLabel} /> : undefined}
    >
      {/* The block's own section already carries the name. */}
      <ol className="space-y-16">
        <FlowStop name={sourceBinName} placeholder="Select source bin">
          <FlowSegment
            label="Feedstock in"
            massKg={feedstockKg}
            moisturePercent={feedstockMoisturePercent}
            dryMassKg={feedstockDryKg}
            materialLabel="Feedstock"
            scaleKg={scaleKg}
          />
        </FlowStop>
        <FlowStop name={reactorName} placeholder="Select reactor">
          <FlowSegment
            label="Biochar out"
            massKg={biocharKg}
            moisturePercent={biocharMoisturePercent}
            dryMassKg={biocharDryKg}
            materialLabel="Biochar"
            scaleKg={scaleKg}
          />
        </FlowStop>
        <FlowStop name={destinationBinName} placeholder="Select destination bin" />
      </ol>
    </CompositionCard>
  );
}

/**
 * A stop: its name, then the segment leaving it. The final stop has no segment.
 *
 * An unselected stop still shows, with the placeholder naming which field to
 * fill, so the shape of a run is visible before its bins are picked.
 */
function FlowStop({ name, placeholder, children }: { name: string | null; placeholder: string; children?: ReactNode }) {
  return (
    <li className="min-w-0 space-y-8">
      <p className={`body-small font-medium ${name ? "" : "text-[var(--color-text-tertiary)]"}`}>{name ?? placeholder}</p>
      {children}
    </li>
  );
}

/**
 * The segment between two stops: what travelled it, how much of it, and the
 * split between the dry matter and the water. It sits flat with no box of its
 * own: a frame around derived figures would only decorate them. The mass stays
 * pinned right against the wrapping label, the way a transport leg pins its
 * distance.
 */
function FlowSegment({ label, massKg, moisturePercent, dryMassKg, materialLabel, scaleKg }: {
  label: string;
  massKg: number | null;
  moisturePercent: number | null;
  dryMassKg: number | null;
  materialLabel: string;
  /** The heavier of the two wet masses: the mass that fills the row. */
  scaleKg: number;
}) {
  const barWidthPercent = flowBarWidthPercent(massKg, scaleKg);
  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between gap-8">
        <p className="body-small text-[var(--color-text-secondary)]">{label}</p>
        {/* No mass yet means no figure: the split bar below already names the
            field that is missing, and "Not recorded wet" reads as a value. */}
        {massKg !== null && <span className="shrink-0 body-small font-medium tabular-nums">{formatMassKg(massKg)} wet</span>}
      </div>
      <MoistureSplit calculation={false} barWidthPercent={barWidthPercent} wetMassKg={massKg} moisturePercent={moisturePercent} dryMassKg={dryMassKg} materialLabel={materialLabel} />
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
