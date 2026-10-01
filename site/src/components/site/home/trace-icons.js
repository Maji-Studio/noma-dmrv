// Row icons for TraceStage: one side-view line drawing per step, on a 32x24 grid, stroked in
// currentColor. Drawn by hand to read at label size; the full contour drawings in ./contours are too
// fine for that. `.ts-icon-mask` parts (wheels) fill with the stage colour so lines behind them stop.
export const ICON_VIEWBOX = "0 0 32 24";

const wheels = (...xs) => xs.map((x) => `<circle class="ts-icon-mask" cx="${x}" cy="19" r="2.5"/>`).join("");
const cab = `<path d="M20 17V10h5l4 3.5V17z"/><path d="M22 12h3"/>`;

export const TRACE_ICONS = {
  // Tipper with a heaped load of residue.
  "feedstock-delivery": `<path d="M2 8h17v9H2z"/><path d="M3 8q7.5-6 15 0"/>${cab}${wheels(7, 25)}`,
  // Kiln: a drum on legs with a stack.
  "production-run": `<path d="M8 8h14a3 5 0 0 1 0 10H8"/><ellipse cx="8" cy="13" rx="3" ry="5"/><path d="M14 8v10M19 8v10"/><path d="M24 8.5V3h3v8"/><path d="M10 18v3M21 18v3M4 21h24"/>`,
  // Bin fed by two runs.
  "mix-bin": `<path d="M7 12h18l-2.5 9h-13z"/><path d="M9.5 16.5h13"/><path d="M11 2v7M9 7l2 2 2-2M21 2v7M19 7l2 2 2-2"/>`,
  // Bulk bag with lifting loops.
  "biochar-product": `<path d="M9 9h14v12H9z"/><path d="M10.5 9V5.5H13V9M19 9V5.5h2.5V9"/><path d="M13 13h6v4h-6z"/>`,
  // Flatbed carrying two bags.
  "delivery": `<path d="M2 15h18v2H2z"/><path d="M3 8h7v7H3zM11 8h7v7h-7z"/>${cab}${wheels(7, 25)}`,
  // Tractor spreading granules behind it.
  "application": `<path d="M9 12V5h6v7"/><path d="M15 11h8v6H13"/><path d="M1 23.5h30"/><circle class="ts-icon-mask" cx="10" cy="17.5" r="4.5"/><circle cx="10" cy="17.5" r="1"/><circle class="ts-icon-mask" cx="23" cy="19.5" r="2.5"/><path d="M2 14h.01M4 17h.01M2.5 20h.01M5 21h.01M3.5 11.5h.01"/>`,
};
