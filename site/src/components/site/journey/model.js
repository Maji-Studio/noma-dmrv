// Journey page: the records. Everything visible is derived from the committed snapshot
// (site/src/data/journey/journey.json); nothing is typed in by hand except layout and vocabulary.
// A value the snapshot lacks stays missing and is shown as "Not recorded".
import J from "../../../data/journey/journey.json";
import { MONTH, dt, dtRange, kg, monthYear, nf, pc, tn } from "./format.js";
import { P } from "./geo.js";

export { J };
export const H_CORG_LIMIT = 0.5; // Isometric eligibility limit (noma H_TO_C_ORG_ELIGIBILITY_MAX)
export const READ_DATE = dt(J.meta.generated);

/* ---------- vocabulary ---------- */
export const GL = {
  sup: "M8 2.5l5 7.5H3z M8 10v3.5", fs: "M1.8 5h7.4v6H1.8z M9.2 7.4h2.9l2.1 2.1V11H9.2 M4 13h.01 M11.5 13h.01",
  fbin: "M3 5h10l-1.2 8.5H4.2z M2.2 5h11.6", run: "M8 2.2c2 2.8 4 4.2 4 7a4 4 0 0 1-8 0c0-1.8 1-3 2-3.8.1 1.6.9 2.6 2 2.8-.3-2.1-.6-4 0-6z",
  bbin: "M2.5 4.5h11 M2.5 8h11 M2.5 11.5h11", prod: "M8 2.8a5.2 5.2 0 1 0 .01 0z M8 2.8v10.4",
  del: "M1.8 5h7.4v6H1.8z M9.2 7.4h2.9l2.1 2.1V11H9.2 M4 13h.01 M11.5 13h.01", app: "M2 13h12 M3 10h10 M4.5 7h7 M6 4h4",
  cb: "M3 3h10v10H3z M5.4 8.2l1.9 1.9 3.3-4", smp: "M6 2.2h4 M7 2.2v4l-3.6 6.8h9.2L9 6.2v-4",
};
// kind -> [label, domain colour name]
export const KIND = { sup: ["Supplier", "infra"], fs: ["Feedstock intake", "prod"], fbin: ["Feedstock bin", "prod"], run: ["Production run", "prod"], bbin: ["Biochar bin", "prod"], smp: ["Lab sample", "ver"], prod: ["Biochar product", "dist"], del: ["Delivery", "dist"], app: ["Application", "dist"], cb: ["Credit batch", "ver"] };
const PLURAL = { sup: "suppliers", fs: "intakes", fbin: "bins", run: "runs", bbin: "bins", smp: "lab samples", prod: "products", del: "deliveries", app: "fields", cb: "credit batches" };

/* ---------- lookups ---------- */
const { runs, applications: apps, deliveries: dels, products: prods, labSamples: sams, creditBatches: cbs } = J;
export { runs, apps, dels, prods, sams, cbs };
const runBy = Object.fromEntries(runs.map((r) => [r.code, r]));
const delBy = Object.fromEntries(dels.map((d) => [d.code, d]));
const appByDel = Object.fromEntries(apps.map((a) => [a.delivery, a]));
const supBy = Object.fromEntries(J.suppliers.map((s) => [s.code, s]));
const alloc = (a) => a.allocations.filter((x) => x.wetKg >= 0.01);
export const appBy = (c) => apps.find((a) => a.code === c);
const cust = (d) => `Customer, ${d.destination.city}`;
const supShort = (s) => s.name.replace(/ (Ltd|Limited)$/, "");
// Anonymised suppliers are named by town ("Supplier, Kinyanambo"), so the town is not repeated.
const supTown = (s) => { const town = s.location.city || "location not recorded"; return supShort(s).includes(town) ? "" : town; };
export { supShort, supTown };
const binName = (b) => `${MONTH[+b.name.slice(-2) - 1]} biochar`;

export const ANCHOR = J.meta.anchorCreditBatch;
export const SUPS = J.suppliers.filter((s) => s.deliveriesToPineOffcutBin > 0).map((s) => s.code);
export const ALL_APPS = apps.map((a) => a.code);
export const ALL_RUNS = runs.map((r) => r.code);
const FEED_BIN = J.feedstockFanIn.binCode;
const HERO = { feedBin: FEED_BIN, run: J.heroRun.code, app: J.heroApplication.code, del: J.heroDelivery.code, bin: J.heroRun.outputBin, cb: J.heroRun.creditBatch, prod: J.heroApplication.allocations[0].product, intakes: J.heroFeedstockDeliveries.map((f) => f.code), sup: J.heroFeedstockDeliveries[0].supplier };
HERO.sample = sams.find((s) => s.creditBatch === HERO.cb).code;
export { HERO };
const runFields = {};
const runProds = {};
runs.forEach((r) => { runFields[r.code] = []; runProds[r.code] = []; });
apps.forEach((a) => new Set(alloc(a).map((x) => x.run)).forEach((r) => runFields[r].push(a.code)));
prods.forEach((p) => p.sourceRuns.forEach((s) => runProds[s.run].push(p.code)));
const fieldsOfBin = (bin) => apps.filter((a) => alloc(a).some((x) => runBy[x.run].outputBin === bin)).map((a) => a.code);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const nowhere = "none sold yet";

/* ---------- places ---------- */
export const PLANT = P(J.facility.lat, J.facility.lng);
export const PLANT_LL = [J.facility.lng, J.facility.lat];
// Towns that are not the plant's own, named from delivery destinations (one label per town).
export const TOWNS = [];
dels.forEach((d) => {
  const c = d.destination;
  if (c.city !== J.facility.location.split(",")[0] && !TOWNS.some((t) => t.name === c.city)) TOWNS.push({ name: c.city, lng: c.lng, lat: c.lat });
});

/* ---------- records ---------- */
export const R = {};
const add = (o) => (R[o.id] = Object.assign({ stats: [], rows: [], br: [], mc: [], mr: [], g: o.id }, o));
SUPS.forEach((c) => {
  const s = supBy[c];
  const fs = J.heroFeedstockDeliveries.filter((f) => f.supplier === c).map((f) => f.code);
  const where = [s.location.city, s.location.stateRegion].filter(Boolean).join(", ");
  add({ id: c, k: "sup", code: c, date: null, sub: [s.feedstockType?.replace(/ \(.*\)/, ""), s.location.city].filter(Boolean).join(" · "),
    stats: [["To plant", s.distanceToPlantKm, "km"], ["Intakes", s.deliveriesToPineOffcutBin, ""], ["Wet mass", nf(s.wetKgToPineOffcutBin / 1000, 1), "t"]],
    rows: [["Location", where || "Not recorded"], ["Region", s.region], ["Feedstock", s.feedstockType], ["Distance to plant", `${s.distanceToPlantKm} km one way, entered per supplier`], [`Intakes into ${FEED_BIN}`, String(s.deliveriesToPineOffcutBin)], [`Wet mass into ${FEED_BIN}`, kg(s.wetKgToPineOffcutBin)]],
    br: [{ dir: "peer", label: `${SUPS.length} suppliers feed ${FEED_BIN}`, ids: SUPS }, ...(fs.length ? [{ dir: "down", label: `${plural(fs.length, "intake", "intakes")} on ${dt(J.heroFeedstockDeliveries[0].date).replace(/ \d{4}$/, "")}`, ids: fs }] : [])],
    geo: P(s.location.lat, s.location.lng), mc: [`s:${c}`, `l:${c}`], mr: ["t:fbin"] });
});
J.heroFeedstockDeliveries.forEach((f) => {
  const s = supBy[f.supplier];
  const day = dt(f.date).replace(/ \d{4}$/, "");
  add({ id: f.code, k: "fs", code: f.code, date: f.date, sub: `${supShort(s)} · truck, ${f.transport.distanceKmOneWay} km`,
    stats: [["Wet mass", nf(f.wetKg), "kg"], ["Moisture", nf(f.moisturePercent, 1), "%"], ["Dry mass", nf(Math.round(f.dryKg)), "kg"]],
    rows: [["Date", dt(f.date)], ["Supplier", `${s.code}, ${s.location.city || "town not recorded"}`], ["Wet mass", kg(f.wetKg)], ["Moisture", pc(f.moisturePercent)], ["Dry mass", `${nf(f.dryKg, 1)} kg, derived`], ["Transport", `Truck, ${f.transport.distanceKmOneWay} km one way`], ["Round trip", `${f.transport.distanceKmOneWay * 2} km, one way × 2`], ["Into bin", f.bin], [`Drawn by ${HERO.run}`, `${kg(f.kgDrawnByPR_26_005)}, inferred`]],
    note: ["Attribution", "Inferred from the bin's oldest-first draw order. The pooled bin does not record which load went into which run."],
    miss: "Weigh ticket, photo. No documents attached.",
    br: [{ dir: "peer", label: `${HERO.intakes.length} intakes on ${day}`, ids: HERO.intakes }, { dir: "up", label: `${SUPS.length} suppliers feed ${FEED_BIN}`, ids: SUPS }],
    mc: [`l:${f.supplier}`, "t:fbin"], mr: [`s:${f.supplier}`] });
});
const fan = J.feedstockFanIn;
const months = Object.entries(fan.byMonth).sort();
add({ id: FEED_BIN, k: "fbin", code: FEED_BIN, date: null, dlabel: `${MONTH[+months[0][0].slice(5) - 1].slice(0, 3)} to ${MONTH[+months.at(-1)[0].slice(5) - 1].slice(0, 3)} ${months[0][0].slice(0, 4)}`, sub: "Pine off-cuts · pooled, oldest first",
  stats: [["Intakes", fan.deliveriesIntoBinTotal, ""], ["Wet in", nf(fan.wetKgIntoBinTotal / 1000, 1), "t"], ["Runs fed", runs.length, ""]],
  rows: [["Bin", "Pine off-cuts, feedstock bin"], ["Intakes", `${fan.deliveriesIntoBinTotal}, ${HERO.intakes.length} of them shown here`], ["Wet mass in", kg(fan.wetKgIntoBinTotal)],
    ...SUPS.map((c) => [`From ${supShort(supBy[c])}`, `${fan.bySupplier[c].deliveries} intakes, ${tn(fan.bySupplier[c].wetKg)}`]),
    ...months.map(([m, v]) => [MONTH[+m.slice(5) - 1], `${v.deliveries} intakes, ${tn(v.wetKg)}`]),
    [`Drawn by ${runs.length} runs`, `${kg(J.meta.totals.feedstockWetKgUsed)} wet`], ["Draw order", "Oldest first"], ["Latest intake", dt(J.production_ongoing.latestFeedstockIntake)]],
  note: ["Pooled bin", "Runs draw the oldest wood first. Load-to-run links are inferred from that rule, not recorded per truck."],
  br: [{ dir: "up", label: `Came from ${SUPS.length} suppliers`, ids: SUPS }, { dir: "down", label: `Went to ${runs.length} runs`, ids: ALL_RUNS }],
  mc: ["t:fbin"], mr: [...SUPS.map((c) => `l:${c}`), ...SUPS.map((c) => `s:${c}`)] });

const reactorName = J.reactor.name;
runs.forEach((r) => {
  const f = runFields[r.code];
  const p = runProds[r.code];
  const mates = runs.filter((x) => x.outputBin === r.outputBin).map((x) => x.code);
  const br = [];
  if (f.length) br.push({ dir: "down", label: `Went to ${plural(f.length, "field", "fields")}`, ids: f });
  if (p.length > 1) br.push({ dir: "down", label: `Made into ${p.length} products`, ids: p });
  br.push({ dir: "peer", label: `${mates.length} runs in ${r.outputBin}`, ids: mates });
  add({ id: r.code, k: "run", code: r.code, date: r.date, sub: `Run ${r.n} of ${runs.length} · reactor ${reactorName}`,
    stats: [["Feedstock in", nf(r.feedstockWetKg / 1000, 1), "t wet"], ["Biochar out", nf(r.biocharOutputKg), "kg wet"], ["Moisture in", nf(r.feedstockMoisturePercent, 1), "%"]],
    rows: [["Date", dt(r.date)], ["Status", "Complete"], ["Reactor", `${reactorName} (${r.reactor})`], ["Feedstock bin", r.feedstockBin], ["Feedstock in", `${kg(r.feedstockWetKg)} wet`], ["Feedstock moisture", pc(r.feedstockMoisturePercent)], ["Biochar output", `${kg(r.biocharOutputKg)} wet`], ["Biochar moisture", pc(r.biocharMoisturePercent)], ["Yield", `${pc((r.biocharOutputKg / r.feedstockWetKg) * 100)} of wet feedstock, derived`], ["Diesel", `${nf(r.dieselOperationL + r.dieselGensetL, 1)} L`], ["Electricity", `${nf(r.electricityKwh)} kWh`], ["Output bin", r.outputBin], ["Credit batch", r.creditBatch],
      ["Biochar now", f.length ? `On ${plural(f.length, "field", "fields")}` : `In ${r.outputBin}, ${nowhere}`]],
    miss: "Temperatures, residence time, feeding rate.",
    br, mc: ["t:run", ...f.map((x) => `f:${x}`)], mr: ["t:fbin", "t:bbin", ...f.map((x) => `l:${appBy(x).delivery}`)], g: r.creditBatch === ANCHOR ? r.code : `agg-${r.creditBatch}`, fields: f });
});
J.feedstockBins.filter((b) => b.type === "biochar_bin").forEach((b) => {
  const rs = runs.filter((r) => r.outputBin === b.code);
  const made = rs.reduce((a, r) => a + r.biocharOutputKg, 0);
  const f = fieldsOfBin(b.code);
  const ss = sams.filter((s) => s.creditBatch === b.creditBatch).map((s) => s.code);
  add({ id: b.code, k: "bbin", code: b.code, date: null, dlabel: `${binName(b)} ${J.meta.generated.slice(0, 4)}`, sub: `${binName(b)} · ${plural(rs.length, "run", "runs")} · ${b.creditBatch}`,
    stats: [["Made", nf(made / 1000, 1), "t wet"], ["Still here", nf((b.currentEstWetKg || made) / 1000, 1), "t wet"], ["Fields", f.length, ""]],
    rows: [["Runs", `${rs.length}, ${rs[0].code} to ${rs.at(-1).code}`], ["Biochar made", `${kg(made)} wet`], ["Still in bin", b.currentEstWetKg ? `${kg(b.currentEstWetKg)} wet est., ${kg(b.currentDryKg)} dry` : `${kg(made)} wet, ${nowhere}`], ["Left as products", f.length ? `${prods.length} products, ${dels.length} deliveries` : "None yet"], ["Credit batch", `${b.creditBatch}, pending`], ["Lab samples", String(ss.length)]],
    br: [{ dir: "up", label: `Came from ${rs.length} runs`, ids: rs.map((r) => r.code) }, ...(f.length ? [{ dir: "down", label: `Went to ${f.length} fields`, ids: f }] : []), { dir: "peer", label: `${ss.length} lab samples`, ids: ss }],
    mc: ["t:bbin"], mr: ["t:run", ...f.map((x) => `f:${x}`)] });
});
sams.forEach((s) => {
  const peers = sams.filter((x) => x.creditBatch === s.creditBatch).map((x) => x.code);
  const hs = peers.map((c) => sams.find((x) => x.code === c).hToCorg);
  add({ id: s.code, k: "smp", code: s.code, date: s.samplingDate, sub: `${s.creditBatch} · ${s.lab.split(";")[0].replace(/ \(.*\)/, "")}`,
    stats: [["H/Corg", nf(s.hToCorg, 2), `limit ${H_CORG_LIMIT}`], ["Organic C", nf(s.organicCarbonPercent, 1), "%"], ["Analysed", dt(s.analysisDate).replace(/ \d{4}$/, ""), ""]],
    rows: [["Sampled", dt(s.samplingDate)], ["Analysed", dt(s.analysisDate)], ["Credit batch", s.creditBatch], ["H/Corg", `${nf(s.hToCorg, 4)}, limit ${H_CORG_LIMIT}`], ["Batch range", `H/Corg ${nf(Math.min(...hs), 2)} to ${nf(Math.max(...hs), 2)}`], ["Organic carbon", `${pc(s.organicCarbonPercent, 2)} of dry mass`], ["Total carbon", pc(s.totalCarbonPercent, 2)], ["Hydrogen", pc(s.hydrogenPercent, 2)], ["Ash", pc(s.ashPercent, 2)], ["pH", nf(s.ph, 2)], ["Reflectance R0", pc(s.randomReflectanceR0Percent, 2)], ["Moisture as received", pc(s.moisturePercent, 2)], ["Labs", s.lab]],
    note: ["H/Corg", "Hydrogen to organic carbon ratio. Lower means more stable carbon."],
    miss: "Contaminant results. No lab report attached.",
    br: [{ dir: "peer", label: `${peers.length} samples in ${s.creditBatch}`, ids: peers }, { dir: "peer", label: `${sams.length} samples, all batches`, ids: sams.map((x) => x.code) }],
    mc: ["t:smp"], mr: ["t:bbin"] });
});
prods.forEach((p) => {
  const ap = apps.find((a) => alloc(a).some((x) => x.product === p.code));
  const rs = p.sourceRuns.map((s) => s.run);
  const formation = p.formation.replace(/^BCF-\d+-\d+ /, "");
  const br = [];
  if (rs.length > 1) br.push({ dir: "up", label: `Came from ${rs.length} runs`, ids: rs });
  if (rs.includes(HERO.run)) br.push({ dir: "peer", label: `${HERO.run} made ${runProds[HERO.run].length} products`, ids: runProds[HERO.run] });
  br.push({ dir: "peer", label: `${prods.length} products from ${p.sourceBin}`, ids: prods.map((x) => x.code) });
  add({ id: p.code, k: "prod", code: p.code, date: p.placedDate, sub: `${formation} · ${ap ? `to field ${ap.fieldIdentifier}` : "not applied yet"}`,
    stats: [["Biochar", nf(p.biocharWetKg), "kg"], ["Water added", nf(p.waterAddedKg, 1), "kg"], ["Total", nf(Math.round(p.biocharWetKg + p.waterAddedKg)), "kg"]],
    rows: [["Placed", dt(p.placedDate)], ["Biochar made", dt(p.productionDate)], ["Formulation", p.formation.replace(/^(BCF-\d+-\d+) (.+)$/, (_, c, n) => `${n} (${c})`)], ["Biochar", kg(p.biocharWetKg)], ["Biochar moisture", pc(p.biocharMoisturePercent)], ["Water added", `${nf(p.waterAddedKg, 1)} kg`], ["From bin", p.sourceBin], ["From runs", p.sourceRuns.map((s) => `${s.run} (${kg(s.wetKg)})`).join(", ")], ["Product bin", p.binCode]],
    br, mc: ["t:prod"], mr: ["t:bbin", ...(ap ? [`f:${ap.code}`] : [])], field: ap && ap.code });
});
dels.forEach((d) => {
  const ap = appByDel[d.code];
  add({ id: d.code, k: "del", code: d.code, date: d.date, sub: `${cust(d)} · order ${d.order}`,
    stats: [["Delivered", nf(d.deliveredWetKg), "kg wet"], ["Distance", d.distanceKmOneWay, "km"], ["Dry mass", nf(Math.round(d.dryKg)), "kg"]],
    rows: [["Date", dt(d.date)], ["Order", d.order], ["Customer", cust(d)], ["Delivered", `${kg(d.deliveredWetKg)} wet`], ["Moisture", pc(d.moisturePercent, 0)], ["Dry mass", `${nf(d.dryKg, 1)} kg`], ["One way", `${d.distanceKmOneWay} km, entered per customer location`], ["Round trip", `${d.distanceKmRoundTrip} km, one way × 2`], ["Field", `${ap.fieldIdentifier} (${ap.code})`]],
    miss: "Vehicle, transport emissions. No proof of delivery attached.",
    br: [{ dir: "peer", label: `${dels.length} deliveries out`, ids: dels.map((x) => x.code) }],
    mc: [`l:${d.code}`, `f:${ap.code}`], mr: ["t:prod"], field: ap.code });
});
apps.forEach((a) => {
  const d = delBy[a.delivery];
  const rs = [...new Set(alloc(a).map((x) => x.run))];
  const br = [];
  if (rs.length > 1) br.push({ dir: "up", label: `Came from ${rs.length} runs`, ids: rs });
  if (rs.includes(HERO.run)) br.push({ dir: "peer", label: `${HERO.run} reached ${runFields[HERO.run].length} fields`, ids: runFields[HERO.run] });
  br.push({ dir: "peer", label: `${apps.length} fields in ${ANCHOR}`, ids: ALL_APPS });
  add({ id: a.code, k: "app", code: `Field ${a.fieldIdentifier}`, date: a.date, sub: `${a.code} · ${cust(d)} · ${d.distanceKmOneWay} km`,
    stats: [["Applied", nf(a.appliedWetKg), "kg wet"], ["Dry", nf(Math.round(a.appliedDryKg)), "kg"], ["Field", a.fieldSizeHa, "ha"]],
    rows: [["Application", a.code], ["Field", a.fieldIdentifier], ["Date", dt(a.date)], ["Applied", `${kg(a.appliedWetKg)} wet`], ["Applied, dry", `${nf(a.appliedDryKg, 1)} kg`], ["Field size", `${a.fieldSizeHa} ha`], ["Location", `${Math.abs(a.lat).toFixed(2)}° ${a.lat < 0 ? "S" : "N"}, ${a.lng.toFixed(2)}° ${a.lng < 0 ? "W" : "E"}`], ["Evidence method", a.evidenceMethod === "location" ? "Field location" : a.evidenceMethod], ["Delivery", `${a.delivery}, ${d.distanceKmOneWay} km`], ["Biochar from", alloc(a).map((x) => `${x.run} via ${x.product} (${kg(x.wetKg)} product)`).join(", ")], ["Credit batch", `${ANCHOR}, pending`]],
    miss: "Crop, application method. No photo attached.",
    br, geo: P(a.lat, a.lng), mc: [`f:${a.code}`, `l:${a.delivery}`], mr: [], field: a.code, fid: a.fieldIdentifier, town: d.destination.city });
});
cbs.forEach((c) => {
  const rs = runs.filter((r) => r.creditBatch === c.code).map((r) => r.code);
  const ss = sams.filter((s) => s.creditBatch === c.code);
  const hs = ss.map((s) => s.hToCorg);
  const f = c.code === ANCHOR ? ALL_APPS : [];
  const range = c.runCodeRange.replace("..", " to PR-26-");
  const hRange = `${nf(Math.min(...hs), 2)} to ${nf(Math.max(...hs), 2)}`;
  add({ id: c.code, k: "cb", code: c.code, date: null, dlabel: monthYear(c.reportingPeriod.start), pill: "Pending", sub: `${rs.length} runs · ${range}`,
    stats: [["Made", nf(c.biocharKg / 1000, 1), "t wet"], ["Applied", nf(c.appliedDryKg / 1000, 1), "t dry"], ["H/Corg", hRange, ""]],
    rows: [["Status", "Pending, not yet verified or issued"], ["Period", `${dt(c.reportingPeriod.start)} to ${dt(c.reportingPeriod.end)}`], ["Runs", `${rs.length}, ${range}`], ["Feedstock", c.feedstockType], ["Biochar made", `${kg(c.biocharKg)} wet`], ["Applied", c.appliedWetKg ? `${kg(c.appliedDryKg)} dry biochar in ${kg(c.appliedWetKg)} of product, on ${plural(f.length, "field", "fields")}` : "None yet"], ["Lab samples", `${ss.length}, H/Corg ${hRange}, limit ${H_CORG_LIMIT}`], ["Durability option", c.durabilityPathway.replace(/^(\d)(\d{3})_year.*$/, "$1,$2 year")], ["Registry id", "Not issued"]],
    note: ["Counts toward removal", "Only biochar applied to a field. Biochar still in the bin does not count yet."],
    miss: "CO2e removed, registry id.",
    br: [{ dir: "up", label: `Came from ${rs.length} runs`, ids: rs }, ...(f.length ? [{ dir: "down", label: `Applied on ${f.length} fields`, ids: f }] : []), { dir: "peer", label: `${cbs.length} credit batches`, ids: cbs.map((x) => x.code) }],
    mc: f.map((x) => `f:${x}`), mr: ["t:bbin"], fields: f });
});

/* ---------- the selected chain ---------- */
export const CHAIN = [HERO.sup, HERO.intakes[0], FEED_BIN, HERO.run, HERO.bin, HERO.sample, HERO.prod, HERO.del, HERO.app, ANCHOR];
export const VIA = ["dash", "solid", "solid", "solid", "solid", "solid", "solid", "dash", "solid"]; // connector after each step
export const HASH = ["supplier", "intake", "feedbin", "run", "biocharbin", "lab", "product", "delivery", "field", "batch"];
export const HOME = CHAIN.indexOf(HERO.app);
export const CHAIN_G = new Set([HERO.sup, ...HERO.intakes, FEED_BIN, HERO.run, HERO.bin, ANCHOR, HERO.sample, HERO.prod, HERO.del, HERO.app]);
export const SIBLINGS = { sup: SUPS, fs: HERO.intakes, run: ALL_RUNS, bbin: J.feedstockBins.filter((b) => b.type === "biochar_bin").map((b) => b.code), smp: sams.map((x) => x.code), prod: prods.map((x) => x.code), del: dels.map((x) => x.code), app: ALL_APPS, cb: cbs.map((x) => x.code) };
export const sibLabel = (k, n) => plural(n, PLURAL[k].replace(/s$/, ""), PLURAL[k]);

/* ---------- transport legs (routed lines from the snapshot) ---------- */
/** Each leg: key "l:<supplier or delivery code>", recorded km, the road line (or null) and its two ends. */
const routes = J.routes?.legs ?? [];
const legs = [
  ...SUPS.map((code) => ({ id: `in:${code}`, kind: "inbound", recordedKmOneWay: supBy[code].distanceToPlantKm })),
  ...dels.map((d) => ({ id: `out:${d.code}`, kind: "outbound", recordedKmOneWay: d.distanceKmOneWay })),
];
export const LEGS = legs.map((leg) => {
  const l = routes.find((r) => r.id === leg.id) ?? leg;
  const code = l.id.split(":")[1];
  const inbound = l.kind === "inbound";
  const ap = inbound ? null : appByDel[code];
  return { key: `l:${code}`, code, inbound, km: l.recordedKmOneWay, coords: l.coordinates ?? null, from: inbound ? [supBy[code].location.lng, supBy[code].location.lat] : PLANT_LL, to: inbound ? PLANT_LL : [ap.lng, ap.lat], app: ap && ap.code };
});

/* ---------- graph model ---------- */
const GT = { supplier: "sup", feedstockDelivery: "fs", feedstockBin: "fbin", run: "run", biocharBin: "bbin", product: "prod", delivery: "del", application: "app", creditBatch: "cb", labSample: "smp" };
export const ORDER = ["sup", "fs", "fbin", "run", "bbin", "prod", "del", "app", "cb", "smp"];
const AGG_RUN = (cb) => `agg-${cb}`;
export const COUNTS = { sup: SUPS.length, fs: fan.deliveriesIntoBinTotal, fbin: 1, run: runs.length, bbin: J.feedstockBins.filter((b) => b.type === "biochar_bin").length, prod: prods.length, del: dels.length, app: apps.length, cb: cbs.length, smp: sams.length };
export const gNodes = J.graph.nodes.filter((n) => n.type !== "order").map((n) => ({ id: n.id, code: n.code, st: GT[n.type] }));
export const gBy = new Map(gNodes.map((n) => [n.id, n]));
export const gEdges = J.graph.edges.filter((e) => gBy.has(e.from) && gBy.has(e.to)).map((e) => ({ a: e.from, b: e.to }));
apps.forEach((a) => gEdges.push({ a: a.code, b: ANCHOR }));
export const gOut = new Map();
export const gIn = new Map();
gNodes.forEach((n) => { gOut.set(n.id, []); gIn.set(n.id, []); });
gEdges.forEach((e) => { gOut.get(e.a).push(e); gIn.get(e.b).push(e); });
export function walk(start, dir) {
  const adj = dir === "up" ? gIn : gOut;
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const c = q.shift();
    for (const e of adj.get(c)) {
      const n = dir === "up" ? e.a : e.b;
      if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
  }
  return seen;
}
// Row slots per node (layout only). Aggregated run groups sit below the batch's own runs.
const laterCbs = cbs.map((c) => c.code).filter((c) => c !== ANCHOR);
const ROWS = { [SUPS[0]]: 3.25, [SUPS[1]]: 6.75, "agg-fs": 7.25, [FEED_BIN]: 6, [HERO.bin]: 6, [ANCHOR]: 5.5 };
HERO.intakes.forEach((c, i) => { ROWS[c] = 2.5 + i * 1.5; });
runs.filter((r) => r.creditBatch === ANCHOR).forEach((r, i) => { ROWS[r.code] = i * 1.5; });
laterCbs.forEach((c, i) => { ROWS[AGG_RUN(c)] = 13.6 + i * 2.2; ROWS[c] = 13.6 + i * 2.2; });
J.feedstockBins.filter((b) => b.type === "biochar_bin" && b.creditBatch !== ANCHOR).forEach((b) => { ROWS[b.code] = ROWS[b.creditBatch]; });
export const GRAPH = { W: 1500, pad: 44, size: 22, top: 64, edge: 50, pitch: (1500 - 50 * 2) / 9 };
GRAPH.H = GRAPH.top + 17 * GRAPH.pad + 30;
export const gPos = new Map();
gNodes.forEach((n) => {
  const c = ORDER.indexOf(n.st);
  let row = ROWS[n.id];
  if (["prod", "del", "app"].includes(n.st)) row = +n.id.slice(-3) - 1 + 0.3;
  if (n.st === "smp") { const k = +n.id.slice(-3) - 1; row = ROWS[cbs[Math.floor(k / 3)].code] + ((k % 3) - 1) * 1.05; }
  gPos.set(n.id, { x: GRAPH.edge + c * GRAPH.pitch, y: GRAPH.top + row * GRAPH.pad + GRAPH.size / 2, s: n.st === "smp" ? 18 : GRAPH.size });
});
export const isDash = (e) => (gBy.get(e.a).st === "sup" && gBy.get(e.b).st === "fs") || (gBy.get(e.a).st === "del" && gBy.get(e.b).st === "app");
export const gLabel = (n) => {
  if (n.id === "agg-fs") return `${fan.deliveriesIntoBinTotal} intakes`;
  if (n.id.startsWith("agg-")) return `${cbs.find((c) => c.code === n.id.slice(4)).memberRunCount} runs`;
  return n.st === "app" ? R[n.id].fid : n.code;
};
/** Aggregated graph node to the record a tap opens. */
export const gToRec = (gid) => {
  if (gid === "agg-fs") return FEED_BIN;
  if (gid.startsWith("agg-")) return runs.find((r) => r.creditBatch === gid.slice(4)).code;
  return gid;
};
export const LATER_RUNS = runs.filter((r) => r.creditBatch !== ANCHOR).length;
