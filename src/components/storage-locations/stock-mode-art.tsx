/**
 * Drawings for the stock mode cards. Split: three small bins, one batch each.
 * Mix: one bin holding the same three batches blended. Decorative: the card
 * hides the art slot from assistive tech. The loop that plays on hover, focus
 * and selection lives in globals.css under "Stock mode art" (class names here
 * must match it); without motion the art shows its full, settled state.
 */

import type { ReactNode } from "react";
import type { OutputStockMode } from "@/lib/output-stock/stock-mode";
import { OUTPUT_STOCK_MODE_DESCRIPTIONS, outputStockModes } from "@/schemas/storage-locations";

const ART_WIDTH = 112;
const ART_HEIGHT = 44;
const BIN_TOP = 10;
const BIN_BOTTOM = 40;
const BIN_STROKE = 1.5;

/** Split: three bins, each with an inner fill for its batch. */
const SPLIT_BIN_WIDTH = 30;
const SPLIT_BIN_GAP = 8;
const SPLIT_BIN_START = 4;
const SPLIT_TONES = ["a", "b", "c"] as const;
const FILL_INSET = 2.5;
const FILL_TOP = BIN_TOP + 2;
const FILL_HEIGHT = BIN_BOTTOM - FILL_TOP - 1;
const CHIP_WIDTH = 12;
const CHIP_HEIGHT = 5;
const CHIP_START_Y = FILL_TOP + 2;

/** Mix: one wide bin filled with a fixed grid of grains in the three tones. */
const MIX_BIN_X = 20;
const MIX_BIN_WIDTH = 72;
const GRAIN_SIZE = 2.6;
const GRAIN_STEP_X = 4;
const GRAIN_STEP_Y = 4.6;
const GRAIN_COLUMNS = 16;
const GRAIN_ROWS = 6;
/** Rows at the top leave with a draw. */
const DRAWN_ROWS = 2;

function binPath(x: number, width: number): string {
  return `M${x} ${BIN_TOP} V${BIN_BOTTOM} H${x + width} V${BIN_TOP}`;
}

const GRAINS = Array.from({ length: GRAIN_ROWS * GRAIN_COLUMNS }, (_, index) => {
  const column = index % GRAIN_COLUMNS;
  const row = Math.floor(index / GRAIN_COLUMNS);
  return {
    key: index,
    tone: SPLIT_TONES[(column * 7 + row * 5 + column * row) % SPLIT_TONES.length],
    x: MIX_BIN_X + 3.5 + column * GRAIN_STEP_X,
    y: FILL_TOP + 1 + row * GRAIN_STEP_Y,
    drawn: row < DRAWN_ROWS,
  };
});

function StockArt({ mode, children }: { mode: "split" | "mix"; children: ReactNode }) {
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
      <path d={`M1 ${BIN_BOTTOM + 1} H${ART_WIDTH - 1}`} strokeWidth={1} opacity={0.5} />
      {children}
    </svg>
  );
}

/** Three bins side by side, one batch each. A removal lifts from the middle one only. */
export function SplitPilesArt() {
  return (
    <StockArt mode="split">
      {SPLIT_TONES.map((tone, index) => {
        const x = SPLIT_BIN_START + index * (SPLIT_BIN_WIDTH + SPLIT_BIN_GAP);
        return (
          <g key={tone}>
            <rect
              className={`stock-fill stock-fill-${tone}`}
              x={x + FILL_INSET}
              y={FILL_TOP}
              width={SPLIT_BIN_WIDTH - FILL_INSET * 2}
              height={FILL_HEIGHT}
              stroke="none"
              style={{ fill: `var(--stock-batch-${tone})` }}
            />
            <path d={binPath(x, SPLIT_BIN_WIDTH)} />
          </g>
        );
      })}
      <rect
        className="stock-chip"
        x={SPLIT_BIN_START + SPLIT_BIN_WIDTH + SPLIT_BIN_GAP + (SPLIT_BIN_WIDTH - CHIP_WIDTH) / 2}
        y={CHIP_START_Y}
        width={CHIP_WIDTH}
        height={CHIP_HEIGHT}
        stroke="none"
        style={{ fill: "var(--stock-batch-b)" }}
      />
    </StockArt>
  );
}

/** One bin, the same three batches blended. A removal takes a slice holding all three. */
export function MixPileArt() {
  const stripeWidth = CHIP_WIDTH / SPLIT_TONES.length;
  return (
    <StockArt mode="mix">
      {GRAINS.map((grain) => (
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
      ))}
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

/** Cards for the chosen bin type; the caption says what a removal takes from that kind of bin. */
export function stockModeOptions(type: "biochar_bin" | "product_bin") {
  return outputStockModes.map((mode) => ({
    value: mode,
    ...STOCK_MODE_CARD_ART[mode],
    description: OUTPUT_STOCK_MODE_DESCRIPTIONS[type][mode],
  }));
}
