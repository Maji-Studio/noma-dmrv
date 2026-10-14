/**
 * Drawings for the stock mode cards. Split: three small bins, one batch each.
 * Mix: one bin holding the same three batches blended. Decorative: the card
 * hides the art slot from assistive tech. The loop that plays on hover and focus
 * lives in globals.css under "Stock mode art" (class names here
 * must match it); without motion the art shows its settled state.
 */

import type { ReactNode } from "react";
import { OUTPUT_DRAW_ORDERS, type OutputDrawOrder, type OutputStockMode } from "@/lib/output-stock/stock-mode";
import { OUTPUT_DRAW_ORDER_LABELS, OUTPUT_STOCK_MODE_DESCRIPTIONS, outputStockModes, type OutputBinType } from "@/schemas/storage-locations";

const ART_WIDTH = 112;
const ART_HEIGHT = 44;
const BIN_TOP = 10;
const BIN_BOTTOM = 40;
const BIN_STROKE = 1.5;
const BASELINE_STROKE = 1;
const BASELINE_OPACITY = 0.5;
/** Multipliers that scatter the three tones through the mix bin. */
const MIX_SCATTER_COLUMN = 7;
const MIX_SCATTER_ROW = 5;

/** Split: three bins, each holding one batch's grains. */
const SPLIT_BIN_WIDTH = 30;
const SPLIT_BIN_GAP = 8;
const SPLIT_BIN_START = 4;
const SPLIT_TONES = ["a", "b", "c"] as const;
const SPLIT_COLUMNS = 6;
/** The bin a split draw takes from (the middle one). */
const SPLIT_DRAWN_BIN = 1;
const FILL_TOP = BIN_TOP + 2;
const CHIP_WIDTH = 12;
const CHIP_HEIGHT = 5;
const CHIP_START_Y = FILL_TOP + 2;

/** Mix: one wide bin, the same grains blended. */
const MIX_BIN_X = 20;
const MIX_BIN_WIDTH = 72;
const MIX_COLUMNS = 16;
const GRAIN_SIZE = 2.6;
const GRAIN_STEP_X = 4;
const GRAIN_STEP_Y = 4.6;
const GRAIN_ROWS = 6;
/** Rows at the top leave with a draw. */
const DRAWN_ROWS = 2;

const DRAW_DATES = ["01 Oct", "02 Oct", "03 Oct"] as const;
const DRAW_DATE_Y = 5;
const DRAW_DATE_SIZE = 6;
const DRAW_FIRST_INDEX = 0;
const DRAW_LAST_INDEX = SPLIT_TONES.length - 1;

type Tone = (typeof SPLIT_TONES)[number];

function binPath(x: number, width: number): string {
  return `M${x} ${BIN_TOP} V${BIN_BOTTOM} H${x + width} V${BIN_TOP}`;
}

/** A grid of grains centred in a bin; `toneAt` picks each grain's batch, `drawable` whether its top rows leave with a draw. */
function grainGrid(binX: number, binWidth: number, columns: number, toneAt: (column: number, row: number) => Tone, drawable: boolean) {
  const inset = (binWidth - ((columns - 1) * GRAIN_STEP_X + GRAIN_SIZE)) / 2;
  return Array.from({ length: GRAIN_ROWS * columns }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      key: `${binX}-${index}`,
      tone: toneAt(column, row),
      x: binX + inset + column * GRAIN_STEP_X,
      y: FILL_TOP + 1 + row * GRAIN_STEP_Y,
      drawn: drawable && row < DRAWN_ROWS,
    };
  });
}

const splitBinX = (index: number) => SPLIT_BIN_START + index * (SPLIT_BIN_WIDTH + SPLIT_BIN_GAP);

const SPLIT_GRAINS = SPLIT_TONES.flatMap((tone, index) =>
  grainGrid(splitBinX(index), SPLIT_BIN_WIDTH, SPLIT_COLUMNS, () => tone, index === SPLIT_DRAWN_BIN),
);

const MIX_GRAINS = grainGrid(
  MIX_BIN_X,
  MIX_BIN_WIDTH,
  MIX_COLUMNS,
  (column, row) => SPLIT_TONES[(column * MIX_SCATTER_COLUMN + row * MIX_SCATTER_ROW + column * row) % SPLIT_TONES.length],
  true,
);

function Grains({ grains }: { grains: ReturnType<typeof grainGrid> }) {
  return grains.map((grain) => (
    <rect
      key={grain.key}
      className={`stock-grain stock-grain-${grain.tone}${grain.drawn ? " stock-grain-top" : ""}`}
      x={grain.x}
      y={grain.y}
      width={GRAIN_SIZE}
      height={GRAIN_SIZE}
      stroke="none"
      style={{ fill: `var(--stock-batch-${grain.tone})` }}
    />
  ));
}

function StockArt({ mode, children }: { mode: "split" | "mix" | "draw"; children: ReactNode }) {
  return (
    <svg
      className={`stock-art stock-art-${mode}`}
      width={ART_WIDTH}
      height={ART_HEIGHT}
      viewBox={`0 0 ${ART_WIDTH} ${ART_HEIGHT}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={BIN_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={`M1 ${BIN_BOTTOM + 1} H${ART_WIDTH - 1}`} strokeWidth={BASELINE_STROKE} opacity={BASELINE_OPACITY} />
      {children}
    </svg>
  );
}

/** Three bins side by side, one batch each. A draw takes from the middle one only. */
export function SplitPilesArt() {
  return (
    <StockArt mode="split">
      <Grains grains={SPLIT_GRAINS} />
      {SPLIT_TONES.map((tone, index) => (
        <path key={tone} d={binPath(splitBinX(index), SPLIT_BIN_WIDTH)} />
      ))}
      <rect
        className="stock-chip"
        x={splitBinX(SPLIT_DRAWN_BIN) + (SPLIT_BIN_WIDTH - CHIP_WIDTH) / 2}
        y={CHIP_START_Y}
        width={CHIP_WIDTH}
        height={CHIP_HEIGHT}
        stroke="none"
        style={{ fill: `var(--stock-batch-${SPLIT_TONES[SPLIT_DRAWN_BIN]})` }}
      />
    </StockArt>
  );
}

/** One bin, the same three batches blended. A draw takes a slice holding all three. */
export function MixPileArt() {
  const stripeWidth = CHIP_WIDTH / SPLIT_TONES.length;
  return (
    <StockArt mode="mix">
      <Grains grains={MIX_GRAINS} />
      <path d={binPath(MIX_BIN_X, MIX_BIN_WIDTH)} />
      <g className="stock-chip">
        {SPLIT_TONES.map((tone, index) => (
          <rect
            key={tone}
            x={MIX_BIN_X + (MIX_BIN_WIDTH - CHIP_WIDTH) / 2 + index * stripeWidth}
            y={CHIP_START_Y}
            width={stripeWidth}
            height={CHIP_HEIGHT}
            stroke="none"
            style={{ fill: `var(--stock-batch-${tone})` }}
          />
        ))}
      </g>
    </StockArt>
  );
}

const STOCK_MODE_CARD_ART: Record<OutputStockMode, { title: string; art: ReactNode }> = {
  split: { title: "Split", art: <SplitPilesArt /> },
  mix: { title: "Mix", art: <MixPileArt /> },
};

/** Cards for the chosen bin type; the caption says what a draw takes from that kind of bin. */
export function stockModeOptions(type: OutputBinType) {
  return outputStockModes.map((mode) => ({
    value: mode,
    ...STOCK_MODE_CARD_ART[mode],
    description: OUTPUT_STOCK_MODE_DESCRIPTIONS[type][mode],
  }));
}

/** Dated bays stay chronological; the first bay drawn is empty in the settled picture. */
export function DrawOrderArt({ order }: { order: OutputDrawOrder }) {
  const first = order === "oldest_first" ? DRAW_FIRST_INDEX : DRAW_LAST_INDEX;
  return (
    <StockArt mode="draw">
      {SPLIT_TONES.map((tone, index) => (
        <g key={tone}>
          <text x={splitBinX(index) + SPLIT_BIN_WIDTH / 2} y={DRAW_DATE_Y} textAnchor="middle"
            fontSize={DRAW_DATE_SIZE} fill="currentColor" stroke="none">{DRAW_DATES[index]}</text>
          <g className={index === first ? "stock-draw-first" : "stock-draw-waiting"}>
            <Grains grains={grainGrid(splitBinX(index), SPLIT_BIN_WIDTH, SPLIT_COLUMNS, () => tone, false)} />
          </g>
          <path d={binPath(splitBinX(index), SPLIT_BIN_WIDTH)} />
        </g>
      ))}
    </StockArt>
  );
}

export const drawOrderOptions = OUTPUT_DRAW_ORDERS.map((order) => ({
  value: order,
  title: OUTPUT_DRAW_ORDER_LABELS[order],
  description: order === "oldest_first" ? "Empty the earliest batch first." : "Empty the latest batch first.",
  art: <DrawOrderArt order={order} />,
}));
