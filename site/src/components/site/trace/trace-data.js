// Illustrative records for the interactive trace; the larger operation adds context rows around them.
import { makeGraph, STAGES } from "../../../data/core.js";

export const LAYOUT = { width: 1080, height: 300, smallSize: 36, largeSize: 17,
  x: [65, 218, 372, 526, 680, 834, 1000], contextY: [18, 51, 116, 242, 277], extraShift: 14 };
export const DEFAULT_RECORD = "field-coffee";
export const COLUMNS = ["Source", "Intake", "Production", "Storage", "Product", "Delivery", "Application"];

const base = [
  ["source-a", "sup", 0, 85, "Sawmill A", "Wood residues", "Supplier declaration", "Feedstock source recorded"],
  ["source-b", "sup", 0, 205, "Sawmill B", "Wood residues", "Supplier declaration", "Feedstock source recorded"],
  ["intake-a", "fd", 1, 85, "FD-001", "1,000 kg received", "Weighbridge ticket", "800 kg dry feedstock at 20% moisture"],
  ["intake-b", "fd", 1, 205, "FD-002", "1,000 kg received", "Weighbridge ticket", "800 kg dry feedstock at 20% moisture"],
  ["run-a", "run", 2, 85, "PR-001", "270 kg dry biochar", "Reactor log", "300 kg biochar at 10% moisture"],
  ["run-b", "run", 2, 205, "PR-002", "270 kg dry biochar", "Reactor log", "300 kg biochar at 10% moisture"],
  ["mix", "bbin", 3, 145, "Mix bin", "540 kg dry biochar", "Bin movements", "Two production runs, origins retained"],
  ["product", "prod", 4, 145, "Biochar product", "540 kg dry biochar", "Product sheet", "Pure biochar drawn from the mix bin"],
  ["delivery-a", "del", 5, 85, "DL-001", "270 kg dry biochar", "Bill of lading", "Delivered to the coffee field"],
  ["delivery-b", "del", 5, 205, "DL-002", "270 kg dry biochar", "Bill of lading", "Delivered to the maize field"],
  ["field-coffee", "app", 6, 85, "Coffee field", "270 kg dry biochar", "Field photos", "135 kg from each production run"],
  ["field-maize", "app", 6, 205, "Maize field", "270 kg dry biochar", "Field photos", "135 kg from each production run"],
];
// What each record holds, listed on its record card (../RecordCard.astro grammar) beside its evidence.
const run = (out) => [["From PR-001", out], ["From PR-002", out]];
const HOLDS = {
  source: [["Material", "Wood residues"], ["Origin", "Sawmill offcuts"]],
  intake: [["Gross weight", "1,000 kg"], ["Moisture", "20%"], ["Dry feedstock", "800 kg"]],
  run: [["Biochar out", "300 kg"], ["Moisture", "10%"], ["Dry biochar", "270 kg"]],
  mix: [...run("270 kg dry"), ["Dry biochar", "540 kg"]],
  product: [["Drawn from", "Mix bin"], ["Blend", "Pure biochar"], ["Dry biochar", "540 kg"]],
  delivery: (to) => [["Dry biochar", "270 kg"], ["Destination", to]],
  field: [["Dry biochar", "270 kg"], ...run("135 kg")],
};
const HOLDS_OF = { "source-a": HOLDS.source, "source-b": HOLDS.source, "intake-a": HOLDS.intake, "intake-b": HOLDS.intake,
  "run-a": HOLDS.run, "run-b": HOLDS.run, mix: HOLDS.mix, product: HOLDS.product,
  "delivery-a": HOLDS.delivery("Coffee field"), "delivery-b": HOLDS.delivery("Maize field"),
  "field-coffee": HOLDS.field, "field-maize": HOLDS.field };
/** The station drawing (../contours/<station>.svg) for each record type. */
export const STATION_OF = { sup: "source", fd: "feedstock-delivery", run: "production-run", bbin: "mix-bin", prod: "biochar-product", del: "delivery", app: "application" };
const primaryNodes = base.map(([id, st, col, y, code, quantity, evidence, note]) =>
  ({ id, st, col, x: LAYOUT.x[col], y, code, quantity, evidence, note, holds: HOLDS_OF[id], short: STAGES[st].label }));
const primaryEdges = [["source-a", "intake-a"], ["source-b", "intake-b"], ["intake-a", "run-a"],
  ["intake-b", "run-b"], ["run-a", "mix"], ["run-b", "mix"], ["mix", "product"],
  ["product", "delivery-a"], ["product", "delivery-b"], ["delivery-a", "field-coffee"], ["delivery-b", "field-maize"]];

function largeOperation() {
  const nodes = primaryNodes.map((n) => ({ ...n }));
  const edges = primaryEdges.map((e) => [...e]);
  const contextStages = ["fd", "run", "bbin", "prod", "del", "app"];
  LAYOUT.contextY.forEach((y, row) => {
    let previous = row % 2 ? "source-b" : "source-a";
    contextStages.forEach((st, index) => {
      const id = `context-${row}-${st}`;
      nodes.push({ id, st, col: index + 1, x: LAYOUT.x[index + 1] + LAYOUT.extraShift, y,
        code: `${STAGES[st].label} ${row + 3}`, quantity: "Additional operation records",
        evidence: `${STAGES[st].label} record`, note: "Part of the larger illustrative operation" });
      edges.push([previous, id]);
      previous = id;
    });
  });
  return makeGraph(nodes, edges);
}

export const GRAPHS = {
  simple: () => makeGraph(primaryNodes.map((n) => ({ ...n })), primaryEdges),
  large: largeOperation,
};
