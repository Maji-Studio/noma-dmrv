"use client";

/**
 * Batch mass-balance Sankey (plan decision 3): one unit (dry kg) end to end —
 * Feedstock → Production runs → Biochar lots → Applied. Column bars are
 * proportional to their real mass (never normalized); every loss is an
 * explicit labeled exit stub below the column it leaves from. Conversion loss
 * renders as the taper of the ribbon into the production-runs column; net
 * tCO₂e is a header label, not a ribbon.
 */

import type {
  CreditBatchSankeyData,
  SankeyColumnKey,
  SankeyExit,
} from "@/lib/chain-of-custody/sankey";

// ViewBox geometry — scales responsively; all units are viewBox px.
const VIEW_W = 1040;
const VIEW_H = 480;
const COLUMN_XS = [80, 373, 666, 960];
const BAR_W = 20;
const FLOW_TOP = 84;
const FLOW_MAX_H = 230;
/** Non-zero masses always render visibly even next to a dominant column. */
const MIN_BAR_H = 3;
const EXIT_STUB_W = 12;
const EXIT_STUB_H = 26;
const EXIT_ROW_H = 46;

const COLUMN_ACCENTS: Record<SankeyColumnKey, string> = {
  feedstock: "var(--clr-orange)",
  productionRuns: "var(--clr-orange)",
  biocharLots: "var(--clr-orange)",
  applied: "var(--clr-rose)",
};

const RIBBON_FILL = "var(--clr-dark-purple)";
const RIBBON_OPACITY = 0.14;

function formatMassKg(value: number): string {
  return `${Math.round(value).toLocaleString()} kg`;
}

function formatNetCo2e(tons: number): string {
  return `${tons.toLocaleString(undefined, { maximumFractionDigits: 2 })} tCO₂e net`;
}

function exitTone(exit: SankeyExit): string {
  return exit.tone === "alert"
    ? "var(--color-signal-red)"
    : "var(--color-text-tertiary)";
}

export interface BatchSankeyProps {
  sankey: CreditBatchSankeyData;
  batchCode: string;
}

export function BatchSankey({ sankey, batchCode }: BatchSankeyProps) {
  const { columns, exits } = sankey;

  const exitsFor = (key: SankeyColumnKey) =>
    exits.filter((exit) => exit.fromColumn === key);

  // The taper exit (conversion loss) narrows the incoming ribbon; every other
  // exit leaves after its column's bar and reduces the outgoing ribbon.
  const postBarExitMass = (key: SankeyColumnKey) =>
    exitsFor(key)
      .filter((exit) => exit.key !== "conversion_loss")
      .reduce((sum, exit) => sum + exit.massKg, 0);

  const maxMass = Math.max(...columns.map((column) => column.massKg), 0);
  const isEmpty = maxMass <= 0;
  const scale = isEmpty ? 0 : FLOW_MAX_H / maxMass;
  const barHeight = (massKg: number) =>
    massKg <= 0 ? 0 : Math.max(MIN_BAR_H, massKg * scale);

  if (isEmpty) {
    return (
      <div
        className="flex h-full items-center justify-center bg-[var(--color-background-white)]"
        data-testid="batch-sankey-empty"
      >
        <p className="body-medium max-w-[420px] text-center text-[var(--color-text-secondary)]">
          No dry mass is recorded along {batchCode}&apos;s lineage yet, so there
          is no flow to balance.
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative h-full overflow-auto bg-[var(--color-background-white)] p-24"
      data-testid="batch-sankey"
    >
      {sankey.netCo2eRemovalTons != null ? (
        <div className="absolute right-24 top-24 border border-[var(--color-border-secondary)] px-12 py-8">
          <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
            Net removal
          </p>
          <p className="font-mono text-[13px] text-[var(--color-text-primary)]">
            {formatNetCo2e(sankey.netCo2eRemovalTons)}
          </p>
        </div>
      ) : null}

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-full min-h-[360px] w-full"
        role="img"
        aria-label={`Mass balance for credit batch ${batchCode}`}
      >
        {/* Ribbons between adjacent columns */}
        {columns.slice(0, -1).map((column, index) => {
          const next = columns[index + 1];
          const outflowKg = Math.max(
            0,
            column.massKg - postBarExitMass(column.key)
          );
          if (outflowKg <= 0) return null;
          const leftH = barHeight(outflowKg);
          // The ribbon never lands taller than the destination bar — the taper
          // is the conversion loss (or a warned inconsistency).
          const rightH = Math.min(leftH, barHeight(next.massKg));
          const xLeft = COLUMN_XS[index] + BAR_W / 2;
          const xRight = COLUMN_XS[index + 1] - BAR_W / 2;
          return (
            <polygon
              key={`ribbon-${column.key}`}
              points={`${xLeft},${FLOW_TOP} ${xRight},${FLOW_TOP} ${xRight},${FLOW_TOP + rightH} ${xLeft},${FLOW_TOP + leftH}`}
              fill={RIBBON_FILL}
              opacity={RIBBON_OPACITY}
            />
          );
        })}

        {/* Column bars + heads */}
        {columns.map((column, index) => {
          const x = COLUMN_XS[index];
          const height = barHeight(column.massKg);
          const anchor =
            index === 0 ? "start" : index === columns.length - 1 ? "end" : "middle";
          const textX =
            index === 0
              ? x - BAR_W / 2
              : index === columns.length - 1
                ? x + BAR_W / 2
                : x;
          return (
            <g key={column.key}>
              <text
                x={textX}
                y={28}
                textAnchor={anchor}
                className="fill-[var(--color-text-primary)] font-mono text-[13px] font-medium uppercase tracking-[0.08em]"
              >
                {column.label}
              </text>
              <text
                x={textX}
                y={48}
                textAnchor={anchor}
                className="fill-[var(--color-text-secondary)] font-mono text-[12px]"
              >
                {formatMassKg(column.massKg)}
              </text>
              <text
                x={textX}
                y={66}
                textAnchor={anchor}
                className="fill-[var(--color-text-tertiary)] font-mono text-[11px] uppercase tracking-[0.06em]"
              >
                {column.count} {column.count === 1 ? "record" : "records"}
              </text>
              {height > 0 ? (
                <rect
                  x={x - BAR_W / 2}
                  y={FLOW_TOP}
                  width={BAR_W}
                  height={height}
                  fill={COLUMN_ACCENTS[column.key]}
                />
              ) : (
                <line
                  x1={x - BAR_W / 2}
                  x2={x + BAR_W / 2}
                  y1={FLOW_TOP}
                  y2={FLOW_TOP}
                  stroke="var(--color-border-secondary)"
                  strokeWidth={1.5}
                />
              )}

              {/* Labeled exits below the column they leave from */}
              {exitsFor(column.key).map((exit, exitIndex) => {
                const exitTop =
                  FLOW_TOP + FLOW_MAX_H + 24 + exitIndex * EXIT_ROW_H;
                const tone = exitTone(exit);
                const exitAnchor = anchor;
                const exitTextX =
                  index === 0
                    ? x + EXIT_STUB_W
                    : index === columns.length - 1
                      ? x - EXIT_STUB_W
                      : x;
                return (
                  <g key={exit.key} data-testid={`sankey-exit-${exit.key}`}>
                    <polygon
                      points={`${x - EXIT_STUB_W / 2},${exitTop} ${x + EXIT_STUB_W / 2},${exitTop} ${x},${exitTop + EXIT_STUB_H}`}
                      fill={tone}
                    />
                    <text
                      x={exitTextX}
                      y={exitTop + EXIT_STUB_H + 16}
                      textAnchor={exitAnchor}
                      className="font-mono text-[11px] font-medium uppercase tracking-[0.06em]"
                      fill={tone}
                    >
                      {exit.label}
                    </text>
                    <text
                      x={exitTextX}
                      y={exitTop + EXIT_STUB_H + 31}
                      textAnchor={exitAnchor}
                      className="font-mono text-[11px]"
                      fill={tone}
                    >
                      −{formatMassKg(exit.massKg)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {sankey.warnings.length > 0 ? (
        <div className="absolute bottom-24 left-24 max-w-[480px] border border-[var(--color-signal-orange)] bg-[var(--color-background-white)] p-12">
          <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-signal-orange)]">
            Mass balance inconsistencies
          </p>
          <ul className="mt-8 flex flex-col gap-6">
            {sankey.warnings.map((warning) => (
              <li
                key={warning}
                className="body-caption text-[var(--color-text-secondary)]"
              >
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
