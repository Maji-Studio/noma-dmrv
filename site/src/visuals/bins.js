// Bin squares (D): one square is KG_PER_SQUARE kg dry biochar. Split = oldest first, mix = pro-rata.
// Every number that shapes the drawing, the controls or the explanatory text lives in the constants below.
import { copy } from "../content/copy.js";
import { el, fmt, reduceMotion, scrollCue } from "./core.js";
import { BIN_LAYERS } from "./data.js";

// Model
const KG_PER_SQUARE = 10;
const INITIAL_DRAW_KG = 400;
const INITIAL_MOISTURE_PCT = 15;
const MOISTURE_MAX_PCT = 40;
const MOISTURE_STEP_PCT = 1;
const WATER_SQUARES = 60;
const TOTAL = BIN_LAYERS.reduce((a, l) => a + l.dry, 0);

// Geometry (SVG units; 1 unit is 1 CSS px once the diagram stacks on narrow screens)
const PQ = 16;                      // square pitch
const SZ = 13;                      // square size
const INSET = (PQ - SZ) / 2;        // centres a square in its pitch cell
const BED = 196;                    // y of the bin and truck floors
const BIN_LEFT = 16;
const BIN_HEIGHT = 170;
const SPLIT_COLS = 3;               // squares per row inside a sub-bin
const SUBBIN_WIDTH = SPLIT_COLS * PQ + 4;
const SUBBIN_PITCH = SUBBIN_WIDTH + 20;
const MIX_COLS = 9;
const MIX_BIN_RIGHT = BIN_LEFT + 2 + MIX_COLS * PQ + 2;
const TRUCK_COLS = 15;
const TRUCK_X = 262;
const TRUCK_W = TRUCK_COLS * PQ;
const TRUCK_BED_HEIGHT = 24;
const CAB_HEIGHT = 42;
const WHEEL_R = 7;
const VIEW_W = TRUCK_X + TRUCK_W + 58;
const VIEW_H = BED + 36;
const MIN_WIDTH = 500;              // beside nothing else the diagram may not shrink below this
const NARROW_WIDTH = VIEW_W;        // stacked layout: scale 1, so labels stay legible

// Motion (ms unless noted)
const PLAY_MS = 700, UPDATE_MS = 220;
const TRUCK_STAGGER_MS = 22, WATER_LEAD_MS = 450, WATER_STAGGER_MS = 14, BIN_LEAD_MS = 120;
const LIFT_PX = 70;

const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
let uid = 0;

const squaresIn = (l) => l.dry / KG_PER_SQUARE;
const firstDay = BIN_LAYERS[0].date.split(" ")[0], lastDate = BIN_LAYERS[BIN_LAYERS.length - 1].date;
const truckCell = (idx) => ({ x: TRUCK_X + (idx % TRUCK_COLS) * PQ + INSET, y: BED - (Math.floor(idx / TRUCK_COLS) + 1) * PQ + INSET });

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

/** data-readout="false" hides the before/after blocks; data-controls="false" hides controls (use the returned play()). */
export function mountBins(root) {
  const p = "nvb" + uid++;
  const controls = root.dataset.controls !== "false", showRead = root.dataset.readout !== "false";
  root.classList.add("nv-bins");
  root.innerHTML = `${controls ? `<div class="nv-bin-ctrl"><div class="nv-seg" role="group" aria-label="Bin type"><button type="button" data-mode="split" aria-pressed="true">Split bin, FIFO</button><button type="button" data-mode="mix" aria-pressed="false">Mix bin, pro-rata</button></div>
  <label for="${p}-d">Draw dry biochar <span class="nv-mono v-d">${fmt(INITIAL_DRAW_KG)} kg</span><input id="${p}-d" class="i-d" type="range" min="0" max="${TOTAL}" step="${KG_PER_SQUARE}" value="${INITIAL_DRAW_KG}"></label>
  <label for="${p}-m">Departure moisture <span class="nv-mono v-m">${INITIAL_MOISTURE_PCT}%</span><input id="${p}-m" class="i-m" type="range" min="0" max="${MOISTURE_MAX_PCT}" step="${MOISTURE_STEP_PCT}" value="${INITIAL_MOISTURE_PCT}"></label>
  <button type="button" class="nv-btn b-play">Play the draw</button></div>` : ""}
  <div class="nv-scroll"><svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" style="--nv-min:${MIN_WIDTH}px;--nv-min-narrow:${NARROW_WIDTH}px" role="img" aria-label="Bin and truck. One square is ${KG_PER_SQUARE} kg of dry biochar."></svg></div>
  <div class="nv-bin-legend">${BIN_LAYERS.map((l, i) => `<span><i style="background:var(--l${i + 1})"></i>${l.name}, ${l.date}</span>`).join("")}<span><i class="w"></i>Water at departure</span></div>
  ${showRead ? `<div class="nv-bin-read"></div>` : ""}`;
  const scroller = root.querySelector(".nv-scroll");
  scrollCue(scroller, copy.visuals.scrollHint);
  const svg = root.querySelector("svg"), frameG = el("g", {}, svg), sqG = el("g", {}, svg), read = root.querySelector(".nv-bin-read");
  const squares = [];
  BIN_LAYERS.forEach((l, i) => { for (let k = 0; k < squaresIn(l); k++) squares.push({ i, k, w: false, r: el("rect", { width: SZ, height: SZ, rx: 2, class: "nv-sq l" + i }, sqG), x: 0, y: 0, o: 1 }); });
  const water = [];
  for (let k = 0; k < WATER_SQUARES; k++) water.push({ w: true, r: el("rect", { width: SZ, height: SZ, rx: 2, class: "nv-sq w", opacity: 0 }, sqG), x: 0, y: 0, o: 0 });
  const st = { mode: "split", D: INITIAL_DRAW_KG, m: INITIAL_MOISTURE_PCT };
  let raf = 0;
  function drawFrame() {
    frameG.innerHTML = "";
    const lab = (x, a, b) => { const t = el("text", { x, y: BED + 16, "text-anchor": "middle", class: "nv-bin-lab" }, frameG); t.textContent = a; const t2 = el("text", { x, y: BED + 29, "text-anchor": "middle", class: "nv-bin-sub" }, frameG); t2.textContent = b; };
    if (st.mode === "split") BIN_LAYERS.forEach((l, i) => { const bx = BIN_LEFT + i * SUBBIN_PITCH; el("path", { class: "nv-wall", d: `M${bx},${BED - BIN_HEIGHT} V${BED} H${bx + SUBBIN_WIDTH} V${BED - BIN_HEIGHT}` }, frameG); lab(bx + SUBBIN_WIDTH / 2, "Sub-bin " + (i + 1), l.date + ", " + l.m + "%"); });
    else { el("path", { class: "nv-wall", d: `M${BIN_LEFT},${BED - BIN_HEIGHT} V${BED} H${MIX_BIN_RIGHT} V${BED - BIN_HEIGHT}` }, frameG); lab((BIN_LEFT + MIX_BIN_RIGHT) / 2, "Mix bin", `${BIN_LAYERS.length} layers, ${firstDay} to ${lastDate}`); }
    el("path", { class: "nv-wall", d: `M${TRUCK_X - 4},${BED - TRUCK_BED_HEIGHT} V${BED + 2} H${TRUCK_X + TRUCK_W + 4} V${BED - TRUCK_BED_HEIGHT}` }, frameG);
    el("path", { class: "nv-wall", d: `M${TRUCK_X + TRUCK_W + 8},${BED + 2} V${BED - CAB_HEIGHT} H${TRUCK_X + TRUCK_W + 34} L${TRUCK_X + TRUCK_W + 46},${BED - 22} V${BED + 2} Z` }, frameG);
    [TRUCK_X + 26, TRUCK_X + TRUCK_W - 26, TRUCK_X + TRUCK_W + 27].forEach((cx) => el("circle", { class: "nv-wheel", cx, cy: BED + 10, r: WHEEL_R }, frameG));
    const t = el("text", { x: TRUCK_X, y: BED + 32, class: "nv-bin-sub" }, frameG); t.textContent = "On the truck";
  }
  function targets(s) {
    const n = Math.round(s.D / KG_PER_SQUARE), pos = new Map(), truck = [];
    let take;
    if (s.mode === "split") { let left = n; take = BIN_LAYERS.map((l) => { const t = Math.min(squaresIn(l), left); left -= t; return t; }); } else take = alloc(n);
    let j = 0;
    BIN_LAYERS.forEach((l, i) => {
      const c = squaresIn(l);
      if (j % MIX_COLS) j += MIX_COLS - (j % MIX_COLS);
      squares.filter((q) => q.i === i).forEach((q) => {
        if (q.k < c - take[i]) {
          if (s.mode === "split") pos.set(q, { x: BIN_LEFT + i * SUBBIN_PITCH + 2 + (q.k % SPLIT_COLS) * PQ, y: BED - (Math.floor(q.k / SPLIT_COLS) + 1) * PQ + INSET, bin: 1 });
          else { pos.set(q, { x: BIN_LEFT + 2 + (j % MIX_COLS) * PQ, y: BED - (Math.floor(j / MIX_COLS) + 1) * PQ + INSET, bin: 1 }); j++; }
        } else truck.push(q);
      });
    });
    truck.forEach((q, idx) => pos.set(q, { ...truckCell(idx), bin: 0, q: idx }));
    const wn = Math.min(water.length, Math.round((s.D / (1 - s.m / 100) - s.D) / KG_PER_SQUARE));
    water.forEach((w, q) => { const idx = truck.length + q; pos.set(w, { ...truckCell(idx), o: q < wn ? 1 : 0, q: idx, wq: q }); });
    return { pos, n: truck.length };
  }
  function apply(T, dur, stagger) {
    cancelAnimationFrame(raf);
    const items = [...squares, ...water], from = new Map(items.map((q) => [q, { x: q.x, y: q.y, o: q.o }])), start = performance.now();
    if (reduceMotion()) dur = 0;
    const fromBin = (t, f) => t.bin === 0 && f.x < TRUCK_X - 20;
    const delay = (q, t, f) => { if (!stagger) return 0; if (q.w) return T.n * TRUCK_STAGGER_MS + WATER_LEAD_MS + t.wq * WATER_STAGGER_MS; if (fromBin(t, f)) return t.q * TRUCK_STAGGER_MS; return t.bin === 1 ? BIN_LEAD_MS : 0; };
    const tick = (now) => {
      let done = true;
      items.forEach((q) => {
        const f = from.get(q), t = T.pos.get(q);
        let pr = dur ? (now - start - delay(q, t, f)) / dur : 1;
        if (pr < 1) done = false;
        pr = Math.max(0, Math.min(1, pr));
        const e = ease(pr), lift = stagger && !q.w && fromBin(t, f) ? Math.sin(Math.PI * e) * LIFT_PX : 0, to = t.o == null ? 1 : t.o;
        q.x = f.x + (t.x - f.x) * e; q.y = f.y + (t.y - f.y) * e;
        q.o = q.w ? (stagger ? (pr > 0 ? f.o + (to - f.o) * e : 0) : f.o + (to - f.o) * e) : 1;
        q.r.setAttribute("x", q.x.toFixed(1)); q.r.setAttribute("y", (q.y - lift).toFixed(1)); q.r.setAttribute("opacity", q.o.toFixed(2));
      });
      if (!done) raf = requestAnimationFrame(tick);
    };
    if (!dur) tick(start); else raf = requestAnimationFrame(tick);
  }
  const update = (dur) => { apply(targets(st), dur, false); if (read) read.innerHTML = readout(st.D, st.m, st.mode); };
  const play = () => {
    apply(targets({ ...st, D: 0 }), 0, false); apply(targets(st), PLAY_MS, true);
    if (read) read.innerHTML = readout(st.D, st.m, st.mode);
    // On narrow screens the truck sits off to the right: bring it into view.
    if (scroller.scrollWidth > scroller.clientWidth + 1) scroller.scrollTo({ left: scroller.scrollWidth, behavior: reduceMotion() ? "auto" : "smooth" });
  };
  if (controls) {
    const dIn = root.querySelector(".i-d"), mIn = root.querySelector(".i-m");
    const sync = () => { root.querySelector(".v-d").textContent = fmt(st.D) + " kg"; root.querySelector(".v-m").textContent = st.m + "%"; };
    dIn.addEventListener("input", () => { st.D = Number(dIn.value); sync(); update(UPDATE_MS); });
    mIn.addEventListener("input", () => { st.m = Number(mIn.value); sync(); update(UPDATE_MS); });
    root.querySelectorAll(".nv-seg button").forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.mode; root.querySelectorAll(".nv-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); drawFrame(); update(0); }));
    root.querySelector(".b-play").addEventListener("click", play);
  }
  drawFrame(); update(0);
  return { play, set(next) { Object.assign(st, next); drawFrame(); update(0); } };
}
