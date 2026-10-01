// Bin squares (D): one square is 10 kg dry biochar. Split = oldest first, mix = pro-rata.
import { el, fmt, reduceMotion } from "./core.js";
import { BIN_LAYERS } from "./data.js";

const TOTAL = BIN_LAYERS.reduce((a, l) => a + l.dry, 0);
const PQ = 16, SZ = 13, BED = 196;
// Two layouts: "wide" puts the truck right of the bins; "stacked" puts it under them, for narrow screens.
// tx = truck bed left edge, tb = truck bed line. The stacked bed leaves room for a full draw (10 rows).
const LAYOUTS = {
  wide: { tx: 262, tb: BED, viewBox: "0 0 560 232", minWidth: 500 },
  stacked: { tx: 20, tb: BED + 190, viewBox: "0 0 320 426", minWidth: 0 },
};
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
let uid = 0;

function plan(D, mode) {
  if (mode === "split") { let left = D; return BIN_LAYERS.map((l) => { const t = Math.min(l.dry, left); left -= t; return t; }); }
  return BIN_LAYERS.map((l) => (l.dry * D) / TOTAL);
}
function alloc(n) {
  const ex = BIN_LAYERS.map((l) => (l.dry / TOTAL) * n), fl = ex.map(Math.floor);
  let r = n - fl.reduce((a, b) => a + b, 0);
  ex.map((e, i) => [e - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (r > 0) { fl[i]++; r--; } });
  return fl;
}
function readout(D, m, mode) {
  const drawn = plan(D, mode), wet = D / (1 - m / 100), water = wet - D;
  const remWet = BIN_LAYERS.reduce((s, l, i) => s + (l.dry - drawn[i]) / (1 - l.m / 100), 0);
  const box = (label, big, small) => `<div class="nv-ba-box"><span class="nv-label">${label}</span><b>${big}</b><small>${small}</small></div>`;
  return `<div class="nv-ba">${box("Bin before", fmt(TOTAL) + " kg", "dry biochar")}<div class="nv-ba-arrow" aria-hidden="true">→</div>${box("Bin after", fmt(TOTAL - D) + " kg", `dry, about ${fmt(remWet)} kg wet (estimate)`)}</div>
  <div class="nv-ba">${box("Truck before", "0 kg", "empty")}<div class="nv-ba-arrow" aria-hidden="true">→</div>${box("Truck after", fmt(wet) + " kg", `${fmt(D)} kg dry biochar and ${fmt(water)} kg water at ${m}%`)}</div>
  <div class="nv-ba-layers">${BIN_LAYERS.map((l, i) => `<span class="nv-ba-mini"><span>${mode === "split" ? "Sub-bin " + (i + 1) : l.name}</span><b>${fmt(l.dry)}</b><i>→</i><b>${fmt(l.dry - drawn[i])}</b><span class="nv-hint">kg dry</span></span>`).join("")}</div>`;
}

/**
 * data-readout="false" hides the before/after blocks; data-controls="false" hides controls (use the returned play()).
 * Controller: { play(), set(next), layout("wide" | "stacked") }. Layout starts "wide".
 */
export function mountBins(root) {
  const p = "nvb" + uid++;
  const controls = root.dataset.controls !== "false", showRead = root.dataset.readout !== "false";
  root.classList.add("nv-bins");
  root.innerHTML = `${controls ? `<div class="nv-bin-ctrl"><div class="nv-seg" role="group" aria-label="Bin type"><button type="button" data-mode="split" aria-pressed="true">Split bin, FIFO</button><button type="button" data-mode="mix" aria-pressed="false">Mix bin, pro-rata</button></div>
  <label for="${p}-d">Draw dry biochar <span class="nv-mono v-d">400 kg</span><input id="${p}-d" class="i-d" type="range" min="0" max="${TOTAL}" step="10" value="400"></label>
  <label for="${p}-m">Departure moisture <span class="nv-mono v-m">15%</span><input id="${p}-m" class="i-m" type="range" min="0" max="40" step="1" value="15"></label>
  <button type="button" class="nv-btn b-play">Play the draw</button></div>` : ""}
  <div class="nv-scroll"><svg viewBox="${LAYOUTS.wide.viewBox}" style="min-width:${LAYOUTS.wide.minWidth}px" role="img" aria-label="Bin and truck. One square is 10 kg of dry biochar."></svg></div>
  <div class="nv-bin-legend"><span><i style="background:var(--l1)"></i>Layer 1, 8 Sep</span><span><i style="background:var(--l2)"></i>Layer 2, 10 Sep</span><span><i style="background:var(--l3)"></i>Layer 3, 12 Sep</span><span><i class="w"></i>Water at departure</span></div>
  ${showRead ? `<div class="nv-bin-read"></div>` : ""}`;
  const svg = root.querySelector("svg"), frameG = el("g", {}, svg), sqG = el("g", {}, svg), read = root.querySelector(".nv-bin-read");
  const squares = [];
  BIN_LAYERS.forEach((l, i) => { for (let k = 0; k < l.dry / 10; k++) squares.push({ i, k, w: false, inBin: true, r: el("rect", { width: SZ, height: SZ, rx: 2, class: "nv-sq l" + i }, sqG), x: 0, y: 0, o: 1 }); });
  const water = [];
  for (let k = 0; k < 60; k++) water.push({ w: true, r: el("rect", { width: SZ, height: SZ, rx: 2, class: "nv-sq w", opacity: 0 }, sqG), x: 0, y: 0, o: 0 });
  const st = { mode: "split", D: 400, m: 15 };
  let L = LAYOUTS.wide;
  let raf = 0;
  function drawFrame() {
    frameG.innerHTML = "";
    const lab = (x, a, b) => { const t = el("text", { x, y: BED + 16, "text-anchor": "middle", class: "nv-bin-lab" }, frameG); t.textContent = a; const t2 = el("text", { x, y: BED + 29, "text-anchor": "middle", class: "nv-bin-sub" }, frameG); t2.textContent = b; };
    if (st.mode === "split") BIN_LAYERS.forEach((l, i) => { const bx = 16 + i * 72; el("path", { class: "nv-wall", d: `M${bx},${BED - 170} V${BED} H${bx + 52} V${BED - 170}` }, frameG); lab(bx + 26, "Sub-bin " + (i + 1), l.date + ", " + l.m + "%"); });
    else { el("path", { class: "nv-wall", d: `M16,${BED - 170} V${BED} H164 V${BED - 170}` }, frameG); lab(90, "Mix bin", "3 layers, 8 to 12 Sep"); }
    const W = 15 * PQ, TX = L.tx, TB = L.tb;
    el("path", { class: "nv-wall", d: `M${TX - 4},${TB - 24} V${TB + 2} H${TX + W + 4} V${TB - 24}` }, frameG);
    el("path", { class: "nv-wall", d: `M${TX + W + 8},${TB + 2} V${TB - 42} H${TX + W + 34} L${TX + W + 46},${TB - 22} V${TB + 2} Z` }, frameG);
    [TX + 26, TX + W - 26, TX + W + 27].forEach((cx) => el("circle", { class: "nv-wheel", cx, cy: TB + 10, r: 7 }, frameG));
    const t = el("text", { x: TX, y: TB + 32, class: "nv-bin-sub" }, frameG); t.textContent = "On the truck";
  }
  function targets(s) {
    const n = Math.round(s.D / 10), pos = new Map(), truck = [];
    let take;
    if (s.mode === "split") { let left = n; take = BIN_LAYERS.map((l) => { const t = Math.min(l.dry / 10, left); left -= t; return t; }); } else take = alloc(n);
    let j = 0;
    BIN_LAYERS.forEach((l, i) => {
      const c = l.dry / 10;
      if (j % 9) j += 9 - (j % 9);
      squares.filter((q) => q.i === i).forEach((q) => {
        if (q.k < c - take[i]) {
          if (s.mode === "split") pos.set(q, { x: 16 + i * 72 + 2 + (q.k % 3) * PQ, y: BED - (Math.floor(q.k / 3) + 1) * PQ + 1.5, bin: 1 });
          else { pos.set(q, { x: 18 + (j % 9) * PQ, y: BED - (Math.floor(j / 9) + 1) * PQ + 1.5, bin: 1 }); j++; }
        } else truck.push(q);
      });
    });
    truck.forEach((q, idx) => pos.set(q, { x: L.tx + (idx % 15) * PQ + 1.5, y: L.tb - (Math.floor(idx / 15) + 1) * PQ + 1.5, bin: 0, q: idx }));
    const wn = Math.min(water.length, Math.round((s.D / (1 - s.m / 100) - s.D) / 10));
    water.forEach((w, q) => { const idx = truck.length + q; pos.set(w, { x: L.tx + (idx % 15) * PQ + 1.5, y: L.tb - (Math.floor(idx / 15) + 1) * PQ + 1.5, o: q < wn ? 1 : 0, q: idx, wq: q }); });
    return { pos, n: truck.length };
  }
  function apply(T, dur, stagger) {
    cancelAnimationFrame(raf);
    const items = [...squares, ...water], from = new Map(items.map((q) => [q, { x: q.x, y: q.y, o: q.o, inBin: q.inBin }])), start = performance.now();
    items.forEach((q) => { q.inBin = T.pos.get(q).bin === 1; });
    if (reduceMotion()) dur = 0;
    const delay = (q, t, f) => { if (!stagger) return 0; if (q.w) return T.n * 22 + 450 + t.wq * 14; if (t.bin === 0 && f.inBin) return t.q * 22; return t.bin === 1 ? 120 : 0; };
    const tick = (now) => {
      let done = true;
      items.forEach((q) => {
        const f = from.get(q), t = T.pos.get(q);
        let pr = dur ? (now - start - delay(q, t, f)) / dur : 1;
        if (pr < 1) done = false;
        pr = Math.max(0, Math.min(1, pr));
        const e = ease(pr), lift = stagger && !q.w && t.bin === 0 && f.inBin ? Math.sin(Math.PI * e) * 70 : 0, to = t.o == null ? 1 : t.o;
        q.x = f.x + (t.x - f.x) * e; q.y = f.y + (t.y - f.y) * e;
        q.o = q.w ? (stagger ? (pr > 0 ? f.o + (to - f.o) * e : 0) : f.o + (to - f.o) * e) : 1;
        q.r.setAttribute("x", q.x.toFixed(1)); q.r.setAttribute("y", (q.y - lift).toFixed(1)); q.r.setAttribute("opacity", q.o.toFixed(2));
      });
      if (!done) raf = requestAnimationFrame(tick);
    };
    if (!dur) tick(start); else raf = requestAnimationFrame(tick);
  }
  const update = (dur) => { apply(targets(st), dur, false); if (read) read.innerHTML = readout(st.D, st.m, st.mode); };
  const play = () => { apply(targets({ ...st, D: 0 }), 0, false); apply(targets(st), 700, true); if (read) read.innerHTML = readout(st.D, st.m, st.mode); };
  if (controls) {
    const dIn = root.querySelector(".i-d"), mIn = root.querySelector(".i-m");
    const sync = () => { root.querySelector(".v-d").textContent = fmt(st.D) + " kg"; root.querySelector(".v-m").textContent = st.m + "%"; };
    dIn.addEventListener("input", () => { st.D = Number(dIn.value); sync(); update(220); });
    mIn.addEventListener("input", () => { st.m = Number(mIn.value); sync(); update(220); });
    root.querySelectorAll(".nv-seg button").forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.mode; root.querySelectorAll(".nv-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); drawFrame(); update(0); }));
    root.querySelector(".b-play").addEventListener("click", play);
  }
  drawFrame(); update(0);
  function layout(name) {
    const next = LAYOUTS[name];
    if (!next || next === L) return;
    L = next;
    svg.setAttribute("viewBox", L.viewBox);
    svg.style.minWidth = `${L.minWidth}px`;
    root.dataset.layout = name;
    drawFrame(); update(0);
  }
  return { play, layout, set(next) { Object.assign(st, next); drawFrame(); update(0); } };
}
