/**
 * The run as a mass flow: what went into the reactor, what left it, and where
 * the rest went.
 *
 * A Sankey from the source bin through the reactor to the destination bin,
 * band thickness in kilograms on one scale, so 4 t in and 1 t out look like
 * it. On the dry basis the feedstock splits into its water, which is driven
 * off before the reactor, and its dry matter, which enters it; the reactor
 * splits the dry matter into the conversion loss, which leaves as gas, and the
 * dry biochar, which runs on to the bin and meets the biochar's own water
 * there. The exits are the run's losses made visible rather than implied by
 * two bars of different length.
 *
 * Both bases are honest. When either dry mass is missing the flow falls back
 * to wet mass end to end, with water and conversion loss as one exit, and the
 * yield's label says so, rather than mixing a dry numerator with a wet
 * denominator. Until both wet masses are entered nothing is drawn to scale:
 * an unresolved bar names the masses still to enter.
 *
 * Both levels show the yield headline and the flow, because the flow is what
 * the masses above add up to. Detailed adds only the yield arithmetic behind
 * Show calculation.
 */
"use client";

import { CompositionCard } from "@/components/forms/composition-card";
import { DerivedHeadline } from "@/components/forms/derived-headline";
import { MassFlowSankey, type MassFlowDiagram } from "@/components/ui/mass-flow-sankey";
import { formatMassKg, formatPercent } from "@/lib/format-utils";
import { PERCENT_SCALE } from "@/lib/mass-moisture";
import { StockRows, type StockRow } from "@/components/storage-locations/stock-figures";

const YIELD_DIGITS = 1;

const PROCESS_FLOW_HINT =
  "Yield is the biochar leaving the reactor as a share of the feedstock entering it. Dry mass is the basis carbon accounting uses. Conversion loss is the mass the reactor releases as gas.";

const PLACEHOLDERS = {
  source: "Select source bin",
  reactor: "Select reactor",
  destination: "Select destination bin",
} as const;

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

function stop(name: string | null, placeholder: string) {
  return { name: name ?? placeholder, placeholder: name === null };
}

/**
 * The flow on the run's basis, or null while a wet mass is missing. A dry
 * mass that does not fit inside its wet mass cannot be split, so the flow
 * falls back to wet rather than drawing negative water.
 */
export function processFlowDiagram(props: ProcessFlowProps): MassFlowDiagram | null {
  const { feedstockKg, feedstockDryKg, biocharKg, biocharDryKg } = props;
  if (feedstockKg === null || biocharKg === null || feedstockKg <= 0) return null;
  const source = stop(props.sourceBinName, PLACEHOLDERS.source);
  const reactor = stop(props.reactorName, PLACEHOLDERS.reactor);
  const destination = stop(props.destinationBinName, PLACEHOLDERS.destination);
  const splits =
    feedstockDryKg !== null && biocharDryKg !== null && feedstockDryKg <= feedstockKg && biocharDryKg <= biocharKg;

  if (!splits) {
    const lossKg = Math.max(0, feedstockKg - biocharKg);
    return {
      nodes: [
        { id: "source", column: 0, ...source, caption: `${formatMassKg(feedstockKg)} wet`, segments: [{ id: "feed", kg: feedstockKg, kind: "wet" }] },
        {
          id: "reactor",
          column: 1,
          ...reactor,
          segments: [
            { id: "loss", kg: lossKg, kind: "released" },
            { id: "made", kg: biocharKg, kind: "process" },
          ],
        },
        { id: "destination", column: 2, ...destination, caption: `${formatMassKg(biocharKg)} wet`, segments: [{ id: "biochar", kg: biocharKg, kind: "wet" }] },
      ],
      links: [
        { from: "feed", to: "reactor" },
        { from: "made", to: "biochar" },
      ],
      exits: [{ from: "loss", name: "Water and conversion loss", caption: formatMassKg(lossKg) }],
    };
  }

  const feedWaterKg = feedstockKg - feedstockDryKg;
  const lossKg = Math.max(0, feedstockDryKg - biocharDryKg);
  return {
    nodes: [
      {
        id: "source",
        column: 0,
        ...source,
        caption: `${formatMassKg(feedstockKg)} wet, ${formatMassKg(feedstockDryKg)} dry`,
        segments: [
          { id: "feed-water", kg: feedWaterKg, kind: "water" },
          { id: "feed-dry", kg: feedstockDryKg, kind: "dry" },
        ],
      },
      {
        id: "reactor",
        column: 1,
        ...reactor,
        segments: [
          { id: "loss", kg: lossKg, kind: "released" },
          { id: "made", kg: biocharDryKg, kind: "process" },
        ],
      },
      {
        id: "destination",
        column: 2,
        ...destination,
        caption: `${formatMassKg(biocharKg)} wet, ${formatMassKg(biocharDryKg)} dry`,
        segments: [
          { id: "biochar-dry", kg: biocharDryKg, kind: "dry" },
          { id: "biochar-water", kg: biocharKg - biocharDryKg, kind: "water" },
        ],
      },
    ],
    links: [
      { from: "feed-dry", to: "reactor" },
      { from: "made", to: "biochar-dry" },
    ],
    exits: [
      { from: "feed-water", name: "Water driven off", caption: formatMassKg(feedWaterKg) },
      { from: "loss", name: "Conversion loss", caption: formatMassKg(lossKg) },
    ],
  };
}

/** Which wet masses the flow still needs, in the order the form asks for them. */
function missingMasses({ feedstockKg, biocharKg }: ProcessFlowProps): string {
  const missing = [
    feedstockKg === null || feedstockKg <= 0 ? "the feedstock wet mass" : null,
    biocharKg === null ? "the biochar wet mass" : null,
  ].filter(Boolean);
  return missing.join(" and ");
}

export function ProcessFlowPreview(props: ProcessFlowProps) {
  const { sourceBinName, reactorName, destinationBinName } = props;
  if (!sourceBinName && !reactorName && !destinationBinName) return null;
  const basis = resolveBasis(props);
  // Until a yield resolves there is no basis to name, only the figure missing.
  const yieldLabel = basis.yieldPercent === null ? "Yield" : `${basis.dry ? "Dry" : "Wet"} yield`;
  const diagram = processFlowDiagram(props);

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
      {diagram ? (
        <MassFlowSankey diagram={diagram} />
      ) : (
        <div className="flex flex-col gap-6">
          <div
            aria-hidden="true"
            className="moisture-water-hatch h-10 w-full border border-dashed border-[var(--color-border-secondary)]"
          />
          <p className="body-caption text-[var(--color-text-tertiary)]">
            Record {missingMasses(props)} to draw the flow.
          </p>
        </div>
      )}
    </CompositionCard>
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
