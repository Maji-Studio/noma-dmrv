// Journey page: the credit batch summary (opened from the header). KPIs, the H/Corg chart, latest
// records, all batches at the facility, and what is not recorded. All values come from the snapshot.
import { ANCHOR, H_CORG_LIMIT, HERO, J, READ_DATE, cbs, dels, runs, sams, apps } from "./model.js";
import { MONTH, dt, dtRange, esc, monthYear, nf, tn } from "./format.js";
import { $, ctx, mk } from "./state.js";
import { GITHUB_URL } from "../../../config.js";

const HC = { labelW: 70, plotW: 282, max: 0.55, rowH: 15, top: 8, axisY: 56 };
const hx = (v) => HC.labelW + (v / HC.max) * HC.plotW;
const lastIso = (xs) => xs.reduce((a, b) => (a > b ? a : b));
const firstIso = (xs) => xs.reduce((a, b) => (a < b ? a : b));

function kpis() {
  const c = cbs.find((x) => x.code === ANCHOR);
  const own = runs.filter((r) => r.creditBatch === ANCHOR);
  const ss = sams.filter((s) => s.creditBatch === ANCHOR);
  const hs = ss.map((s) => s.hToCorg); const oc = ss.map((s) => s.organicCarbonPercent);
  const bin = J.feedstockBins.find((b) => b.code === HERO.bin);
  const appDates = apps.map((a) => a.date);
  return [
    ["Runs", String(own.length), `${own[0].code} to ${own.at(-1).code}`],
    ["Biochar made", `${tn(c.biocharKg)} wet`, `Made ${dtRange(firstIso(own.map((r) => r.date)), lastIso(own.map((r) => r.date)))}`],
    ["Applied", `${tn(c.appliedDryKg)} dry`, `In ${tn(c.appliedWetKg)} of product, ${apps.length} fields, ${dtRange(firstIso(appDates), lastIso(appDates))}`],
    ["Still in bin", `${tn(bin.currentEstWetKg)} wet est.`, `${tn(bin.currentDryKg)} dry, ${bin.code}, not applied yet`],
    ["H/Corg", `${nf(Math.min(...hs), 2)} to ${nf(Math.max(...hs), 2)}`, `${ss.length} samples, limit ${H_CORG_LIMIT}`],
    ["Organic carbon", `${nf(Math.min(...oc), 1)} to ${nf(Math.max(...oc), 1)} %`, "Of dry mass"],
  ];
}

function chart() {
  const hc = $("hc");
  [0, 0.1, 0.2, 0.3, 0.4].forEach((v) => {
    mk("line", { class: "hc-axis", x1: hx(v), x2: hx(v), y1: 2, y2: 44, opacity: 0.45 }, hc);
    mk("text", { class: "hc-t", x: hx(v), y: HC.axisY, "text-anchor": "middle" }, hc).textContent = v.toFixed(1);
  });
  mk("line", { class: "hc-lim", x1: hx(H_CORG_LIMIT), x2: hx(H_CORG_LIMIT), y1: 0, y2: 46 }, hc);
  mk("text", { class: "hc-t l", x: hx(H_CORG_LIMIT), y: HC.axisY, "text-anchor": "middle" }, hc).textContent = "LIMIT";
  cbs.forEach((cb, k) => {
    const y = HC.top + k * HC.rowH; const on = cb.code === ANCHOR;
    mk("text", { class: `hc-t${on ? " on" : ""}`, x: 0, y: y + 3 }, hc).textContent = cb.code;
    mk("line", { class: "hc-axis", x1: hx(0), x2: hx(HC.max), y1: y, y2: y, opacity: 0.5 }, hc);
    sams.filter((x) => x.creditBatch === cb.code).forEach((x) => mk("circle", { class: `hc-dot${on ? " on" : ""}`, cx: hx(x.hToCorg), cy: y, r: on ? 3.6 : 3 }, hc));
  });
  const all = sams.map((s) => s.hToCorg);
  const own = sams.filter((s) => s.creditBatch === ANCHOR).map((s) => s.hToCorg);
  hc.setAttribute("aria-label", `${sams.length} lab samples, H/Corg ${nf(Math.min(...all), 2)} to ${nf(Math.max(...all), 2)}. The ${own.length} from ${ANCHOR} are ${nf(Math.min(...own), 2)} to ${nf(Math.max(...own), 2)}. All are below the ${H_CORG_LIMIT} limit.`);
}

function latest() {
  const po = J.production_ongoing;
  const lastDels = dels.filter((d) => d.date === po.latestDeliveryOut);
  const cb = (d) => runs.find((r) => r.code === apps.find((a) => a.delivery === d.code).allocations[0].run).creditBatch;
  const lastSam = sams.reduce((a, b) => (b.analysisDate > a.analysisDate ? b : a));
  const lastRun = runs.find((r) => r.code === po.latestRun);
  const items = [
    ["Delivery and application", `${lastDels.map((d) => d.code).join(", ")} · ${[...new Set(lastDels.map(cb))].join(", ")}`, po.latestDeliveryOut],
    ["Lab analysis", `${lastSam.code} · ${lastSam.creditBatch}`, lastSam.analysisDate],
    ["Production run", `${po.latestRun} · run ${lastRun.n} of ${runs.length}`, po.latestRunDate],
    ["Feedstock intake", `Into ${J.feedstockFanIn.binCode}`, po.latestFeedstockIntake],
  ].sort((a, b) => (a[2] < b[2] ? 1 : -1));
  $("late").innerHTML = items.map((x, i) => `<li${i ? "" : ' class="cur"'}><span>${x[0]}</span><b>${dt(x[2])}</b><small>${esc(x[1])}</small></li>`).join("");
}

function batches() {
  const t = J.meta.totals;
  $("cbs").innerHTML = `${cbs.map((x) => `<li${x.code === ANCHOR ? ' class="cur"' : ""}><span>${x.code} · ${MONTH[+x.reportingPeriod.start.slice(5, 7) - 1]}</span><b class="pend">${x.status === "pending" ? "Pending" : esc(x.status)}</b><small>${x.memberRunCount} runs · ${tn(x.biocharKg)} made, wet · ${x.appliedDryKg ? `${tn(x.appliedDryKg)} dry applied` : "none applied yet"}</small></li>`).join("")}<li><span>Facility total</span><b>${tn(t.biocharKg)}</b><small>${t.runs} runs, ${dtRange(t.firstRun, t.lastRun)}</small></li>`;
}

function open(isOpen) {
  $("sum").hidden = !isOpen; $("scrim").hidden = !isOpen; $("batchBtn").setAttribute("aria-expanded", isOpen);
  if (isOpen) $("sumX").focus({ preventScroll: true }); else $("batchBtn").focus({ preventScroll: true });
  ctx.setHash();
}

export function mount() {
  $("kpi").innerHTML = kpis().map(([k, v, s]) => `<div><dt>${k}</dt><dd>${esc(v)}<small>${esc(s)}</small></dd></div>`).join("");
  chart(); latest(); batches();
  const po = J.production_ongoing;
  const lab = sams.reduce((a, b) => (b.analysisDate > a.analysisDate ? b : a)).analysisDate;
  $("chipline").lastChild.textContent = `Latest record ${dt(lastIso([po.latestDeliveryOut, po.latestApplication, po.latestRunDate, po.latestFeedstockIntake, lab]))}`;
  $("sumPeriod").textContent = `Credit batch · ${monthYear(cbs.find((x) => x.code === ANCHOR).reportingPeriod.start)}`;
  $("sumSrc").textContent = `Records from Dark Earth Carbon's noma dMRV, read ${READ_DATE}. Road lines routed by OpenRouteService; distances shown are the recorded ones.`;
  $("sumCode").setAttribute("href", GITHUB_URL);
  $("batchBtn").addEventListener("click", () => open($("sum").hidden));
  $("sumX").addEventListener("click", () => open(false));
  $("scrim").addEventListener("click", () => open(false));
  ctx.openSum = open;
}
