// Made-up, fixed-seed example data shaped like the Mafinga seed (src/lib/cli/seed/constants.ts).
import { fmt, makeGraph, rng, walk } from "./core.js";

/** One removal, end to end. Node ids are stable: variants may pin them (s1 f1 b1 r1 l1 p1 d1 a1 rm s2 f2 i1 cb sm). */
export const CHAIN_NODES = [
  { id: "s1", st: "sup", x: 40, y: 150, code: "Sawmill A", short: "Supplier", meta: ["Forestry waste", "15 km from the plant"] },
  { id: "f1", st: "fd", x: 150, y: 150, code: "FD-2026-001", short: "Delivery in", meta: ["2,000 kg wet at 20% moisture", "1,600 kg dry", "Weighbridge ticket attached"] },
  { id: "b1", st: "fbin", x: 260, y: 150, code: "Feedstock bin 1", short: "Feedstock bin", meta: ["Wet-mass stock", "Withdrawn pro-rata"] },
  { id: "r1", st: "run", x: 370, y: 150, code: "PR-2026-043", short: "Production run", meta: ["1,000 kg feedstock in at 20%", "300 kg biochar out at 10%", "270 kg dry biochar", "24 kWh, 14 L diesel"] },
  { id: "l1", st: "bbin", x: 490, y: 150, code: "Bin A, layer 3", short: "Biochar bin", meta: ["270 kg dry biochar", "Split bin: drawn oldest layer first"] },
  { id: "p1", st: "prod", x: 620, y: 150, code: "BCF-01", short: "Product", meta: ["Formulation: chicken manure 50/50", "300 kg biochar + 300 kg manure", "Dry biochar carried: 270 kg"] },
  { id: "d1", st: "del", x: 740, y: 150, code: "DL-2026-012", short: "Delivery out", meta: ["Mafinga to Mbeya, 240 km", "Departure moisture 15%", "Bill of lading attached"] },
  { id: "a1", st: "app", x: 855, y: 150, code: "AP-2026-031", short: "Application", meta: ["Coffee field near Mbeya", "Field boundary recorded", "Applied 21 Sep 2026"] },
  { id: "rm", st: "rem", x: 965, y: 150, code: "RM-2026-004", short: "Removal", meta: ["Submitted as one bundle", "Sources, datapoints, GHG entry"] },
  { id: "s2", st: "sup", x: 260, y: 45, code: "Poultry farm", short: "Supplier", meta: ["Ingredient supplier", "12 km from the plant"] },
  { id: "f2", st: "fd", x: 370, y: 45, code: "FD-2026-002", short: "Delivery in", meta: ["1,000 kg chicken manure", "30% moisture"] },
  { id: "i1", st: "ing", x: 490, y: 45, code: "Manure bin", short: "Ingredient bin", meta: ["Blend ingredient", "Never submitted to the registry"] },
  { id: "cb", st: "cb", x: 490, y: 250, code: "CB-2026-043", short: "Credit batch", meta: ["One feedstock, one month", "3 production runs"] },
  { id: "sm", st: "smp", x: 620, y: 250, code: "3 samples", short: "Lab samples", meta: ["Organic carbon 76%", "H/C org and R0 recorded"] },
];
export const CHAIN_EDGES = [["s1", "f1"], ["f1", "b1"], ["b1", "r1"], ["r1", "l1"], ["l1", "p1"], ["p1", "d1"], ["d1", "a1"], ["a1", "rm"], ["s2", "f2"], ["f2", "i1"], ["i1", "p1"], ["r1", "cb"], ["cb", "sm"], ["cb", "rm"]];
/** Chain ids in custody order, for scroll-driven variants. */
export const CHAIN_ORDER = ["s1", "f1", "b1", "r1", "l1", "p1", "d1", "a1", "rm"];

export const CUSTOMERS = [
  { name: "Coffee farm, Mbeya", lat: -8.91, lng: 33.46 }, { name: "Tea estate, Njombe", lat: -9.33, lng: 34.77 },
  { name: "Maize farm, Makambako", lat: -8.85, lng: 34.83 }, { name: "Vegetable farm, Iringa", lat: -7.77, lng: 35.69 },
  { name: "Avocado farm, Mafinga", lat: -8.42, lng: 35.08 },
];
export const PLANT = { lat: -8.3, lng: 35.28 };
export function km(a, b) {
  const R = 6371, t = Math.PI / 180, dl = (b.lat - a.lat) * t, dg = (b.lng - a.lng) * t;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildDense() {
  const r = rng(20260929), bt = (a, b) => a + r() * (b - a), N = [], E = [];
  const add = (n) => (N.push(n), n), link = (a, b) => E.push([a.id, b.id]);
  const pad = (n, w = 3) => String(n).padStart(w, "0");
  const day = (d) => new Date(Date.UTC(2026, 7, 10 + d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const sups = ["A", "B", "C", "D", "E"].map((k) => { const lat = PLANT.lat + bt(-0.14, 0.14), lng = PLANT.lng + bt(-0.16, 0.16); return add({ id: "sup" + k, st: "sup", code: "Sawmill " + k, lat, lng, meta: ["Forestry waste", Math.round(km(PLANT, { lat, lng }) * 1.25) + " km haul"] }); });
  const poultry = add({ id: "supP", st: "sup", code: "Poultry farm", lat: PLANT.lat - 0.06, lng: PLANT.lng + 0.05, meta: ["Chicken manure", "12 km haul"] });
  const compost = add({ id: "supC", st: "sup", code: "Compost yard", lat: PLANT.lat + 0.09, lng: PLANT.lng - 0.04, meta: ["Compost", "14 km haul"] });
  const fds = [];
  for (let i = 0; i < 22; i++) { const s = sups[Math.floor(r() * 5)], w = Math.round(bt(1500, 3000) / 50) * 50, m = Math.round(bt(16, 28)); fds.push(add({ id: "fd" + i, st: "fd", code: "FD-2026-" + pad(i + 1), meta: [`${fmt(w)} kg wet at ${m}% moisture`, `${fmt(w * (1 - m / 100))} kg dry`, day(i * 2)] })); link(s, fds[i]); }
  const fills = [];
  for (let i = 0; i < 6; i++) fills.push(add({ id: "fb" + i, st: "fbin", code: `Feedstock bin ${(i % 3) + 1}, fill ${Math.floor(i / 3) + 1}`, meta: ["Wet-mass stock, withdrawn pro-rata"] }));
  fds.forEach((f, i) => link(f, fills[Math.min(5, Math.floor(i / 3.7))]));
  const ingF = [];
  for (let i = 0; i < 6; i++) { const s = i < 4 ? poultry : compost; const f = add({ id: "fdi" + i, st: "fd", code: "FD-2026-" + pad(30 + i), meta: [i < 4 ? "1,000 kg chicken manure at 30%" : "800 kg compost at 40%", day(i * 6 + 1)] }); link(s, f); ingF.push(f); }
  const manure = add({ id: "ingM", st: "ing", code: "Manure bin", meta: ["Blend ingredient", "Never submitted"] });
  const comp = add({ id: "ingC", st: "ing", code: "Compost bin", meta: ["Blend ingredient", "Never submitted"] });
  ingF.forEach((f, i) => link(f, i < 4 ? manure : comp));
  const runs = [];
  for (let i = 0; i < 18; i++) {
    const out = Math.round(bt(280, 320)), m = Math.round(bt(8, 12));
    const rn = add({ id: "run" + i, st: "run", code: "PR-2026-" + pad(31 + i), meta: ["1,000 kg feedstock in", `${out} kg biochar at ${m}% moisture`, `${fmt(out * (1 - m / 100))} kg dry biochar`, `${Math.round(bt(20, 28))} kWh, ${Math.round(bt(11, 16))} L diesel`, day(i * 2 + 3)] });
    runs.push(rn); link(fills[Math.floor(i / 3)], rn);
    if (i % 3 === 2 && i < 17) link(fills[Math.min(5, Math.floor(i / 3) + 1)], rn);
  }
  const binDefs = [["Bin A, sub-bin 1", "split"], ["Bin A, sub-bin 2", "split"], ["Bin A, sub-bin 3", "split"], ["Bin B", "mix"], ["Bin C, sub-bin 1", "split"], ["Bin C, sub-bin 2", "split"], ["Bin D", "mix"], ["Bin E", "mix"]];
  const binRuns = [[0, 1], [2, 3], [4, 5], [6, 7, 8], [9, 10], [11, 12], [13, 14, 15], [16, 17]];
  const bins = binDefs.map((b, i) => add({ id: "bin" + i, st: "bbin", code: b[0], mode: b[1], meta: [b[1] === "split" ? "Split bin: drawn oldest layer first" : "Mix bin: every layer drawn pro-rata", `${binRuns[i].length} layers`] }));
  binRuns.forEach((rs, i) => rs.forEach((k) => link(runs[k], bins[i])));
  const forms = ["BCF-01 chicken manure 50/50", "BCF-02 compost 30/70", "Pure biochar"];
  const prods = [];
  for (let j = 0; j < 20; j++) {
    const f = j % 5 === 4 ? 2 : j % 3 === 1 ? 1 : j % 2 ? 2 : 0;
    const p = add({ id: "prod" + j, st: "prod", code: "BCF-" + pad(j + 1, 2), meta: ["Formulation: " + forms[f], `${fmt(bt(250, 300))} kg dry biochar carried`] });
    prods.push(p);
    const bi = Math.min(7, Math.floor((j * 8) / 20));
    link(bins[bi], p);
    if (j % 3 === 0 && bi < 7) link(bins[bi + 1], p);
    if (f === 0) link(manure, p);
    if (f === 1) link(comp, p);
  }
  const dels = [];
  for (let k = 0; k < 28; k++) {
    const c = CUSTOMERS[Math.floor(r() * CUSTOMERS.length)];
    const d = add({ id: "del" + k, st: "del", code: "DL-2026-" + pad(k + 1), cust: c, meta: ["To " + c.name, `${Math.round((km(PLANT, c) * 1.18) / 5) * 5} km by road`, `Departure moisture ${Math.round(bt(12, 22))}%`] });
    dels.push(d);
    const pi = Math.min(19, Math.floor((k * 20) / 28));
    link(prods[pi], d);
    if (k % 4 === 3 && pi < 19) link(prods[pi + 1], d);
  }
  const apps = [];
  for (let m = 0; m < 45; m++) {
    const d = dels[Math.min(27, Math.floor((m * 28) / 45))], c = d.cust;
    const a = add({ id: "app" + m, st: "app", code: "AP-2026-" + pad(m + 1), lat: c.lat + bt(-0.13, 0.13), lng: c.lng + bt(-0.15, 0.15), cust: c.name, meta: [c.name, "Field boundary recorded", day(m + 30)] });
    apps.push(a); link(d, a);
  }
  const cbs = [[0, 4], [5, 9], [10, 13], [14, 17]].map((rg, i) => {
    const cb = add({ id: "cb" + i, st: "cb", code: "CB-2026-" + pad(41 + i), meta: ["Credit batch: one feedstock, one month", `${rg[1] - rg[0] + 1} production runs`] });
    for (let k = rg[0]; k <= rg[1]; k++) link(runs[k], cb);
    return cb;
  });
  cbs.forEach((cb, i) => { for (let k = 0; k < 3; k++) { const s = add({ id: `smp${i}_${k}`, st: "smp", code: `${cb.code} S${k + 1}`, meta: [`Organic carbon ${Math.round(bt(72, 80))}%`, "H/C org and R0 recorded"] }); link(cb, s); } });
  const g0 = makeGraph(N, E.slice());
  for (let q = 0; q < 5; q++) {
    const rm = add({ id: "rem" + q, st: "rem", code: "RM-2026-" + pad(q + 1), meta: ["Removal, one submission", "Datapoints, sources, GHG entry"] });
    const grp = apps.slice(q * 9, q * 9 + 9), cbSet = new Set();
    grp.forEach((a) => {
      link(a, rm);
      walk(g0, a.id, "up").forEach((u) => { if (g0.byId.get(u).st === "run") (g0.out.get(u) || []).forEach((o) => { if (g0.byId.get(o).st === "cb") cbSet.add(o); }); });
    });
    cbSet.forEach((c) => E.push([c, rm.id]));
    rm.meta.push(`${grp.length} fields, ${cbSet.size} credit batch${cbSet.size > 1 ? "es" : ""}`);
  }
  return makeGraph(N, E);
}

/** Layered layout: one column per stage, barycenter ordering over four sweeps. Mutates x/y. */
function layoutDense(g) {
  const COLS = { sup: 40, fd: 160, fbin: 285, ing: 285, run: 405, bbin: 530, prod: 655, del: 780, app: 905, rem: 1150, cb: 470, smp: 600 };
  const mainTop = 24, mainBot = 560, verTop = 610, verBot = 680;
  const cols = {};
  g.nodes.forEach((n) => { (cols[n.st] = cols[n.st] || []).push(n); });
  const place = (list, top, bot) => { const step = (bot - top) / Math.max(1, list.length); list.forEach((n, i) => { n.y = top + step * (i + 0.5); }); };
  const orderMain = ["sup", "fd", "fbin", "run", "bbin", "prod", "del", "app", "rem"];
  orderMain.forEach((k) => { const l = cols[k]; if (k === "fbin") l.push(...cols.ing); if (k === "rem") place(l, mainTop + 60, mainBot - 60); else place(l, mainTop, mainBot); });
  place(cols.cb, verTop, verBot);
  const bary = (n, adj) => { const ps = adj.get(n.id).map((id) => g.byId.get(id)).filter((p) => p.y != null); return ps.length ? ps.reduce((s, p) => s + p.y, 0) / ps.length : n.y; };
  for (let pass = 0; pass < 4; pass++) {
    const seq = pass % 2 ? orderMain.slice().reverse() : orderMain;
    seq.forEach((k) => { const l = cols[k], adj = pass % 2 ? g.out : g.inn; l.forEach((n) => (n._b = bary(n, adj))); l.sort((a, b) => a._b - b._b); if (k === "rem") place(l, mainTop + 60, mainBot - 60); else place(l, mainTop, mainBot); });
  }
  cols.cb.sort((a, b) => bary(a, g.inn) - bary(b, g.inn)); place(cols.cb, verTop, verBot);
  cols.smp.sort((a, b) => bary(a, g.inn) - bary(b, g.inn));
  cols.smp.forEach((n, i) => { n.x = COLS.smp + (i % 3) * 22; });
  const cbY = new Map(cols.cb.map((c) => [c.id, c.y]));
  cols.smp.forEach((n) => { n.y = cbY.get(g.inn.get(n.id)[0]); });
  g.nodes.forEach((n) => { if (n.st !== "smp") n.x = COLS[n.st]; if (cols[n.st].length > 24) n.x += cols[n.st].indexOf(n) % 2 ? 9 : -9; });
  cols.ing.forEach((n) => { n.x = COLS.ing; });
}

let dense = null;
/** The six-week plant graph (about 180 records), built once and shared. Copy nodes before drawing twice. */
export function denseGraph() {
  if (!dense) { dense = buildDense(); layoutDense(dense); }
  return dense;
}

export const MORPH = [
  ["Production run", "PR-2026-043.biocharDryMassKg", "270 kg", "Datapoint, carbon_rich_substance_sequestration", "product_mass", "270 kg"],
  ["Lab sample", "CB-2026-043 S1.organicCarbonPercent", "76 %", "Datapoint, carbon_rich_substance_sequestration", "carbon_content", "0.76"],
  ["Production run", "PR-2026-043.electricityKwh", "24 kWh", "Datapoint, grid_electricity_use", "electricity_use", "24 kWh"],
  ["Production run", "dieselGenset + preprocessing", "6 L", "Datapoint, fuel_usage_by_volume (Generator diesel usage)", "volume_of_fuel", "6 L"],
  ["Delivery out", "DL-2026-012 mass × distance", "0.6 t × 240 km", "Datapoint, mass_distance_based_ci_emissions", "mass_distance", "144 t·km"],
  ["Application", "AP-2026-031.gisBoundary", "GeoJSON polygon", "Biochar Application", "location", "polygon"],
  ["Credit batch", "CB-2026-043", "3 runs, 1 feedstock", "Production batch", "feedstock type", "Isometric catalogue id"],
];

export const BIN_LAYERS = [
  { name: "Layer 1", run: "PR-2026-041", date: "8 Sep", dry: 270, m: 10 },
  { name: "Layer 2", run: "PR-2026-042", date: "10 Sep", dry: 300, m: 12 },
  { name: "Layer 3", run: "PR-2026-043", date: "12 Sep", dry: 240, m: 9 },
];
