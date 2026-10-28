// Journey page: the record list (a swipe carousel of cards on a phone, a vertical timeline accordion on
// desktop), the rail above it, and branch levels. Choosing a record moves st.f, and the map and graph
// cameras follow it (camera.js).
import { CHAIN, GL, KIND, R, READ_DATE, SIBLINGS, VIA, sibLabel } from "./model.js";
import { clamp, dt, esc, pad2 } from "./format.js";
import { $, RM, ctx, desk, lvl, mk, st } from "./state.js";

const CARD_MAX = 460;
const CARD_GUTTER = 44; // px of the next card that shows at the edge
const CARD_GAP = 10;
const SNAP_REST_MS = 140;
const MAX_DEPTH = 4;
const FAN = 0.05; // how much a card shrinks as it leaves the centre
const FADE = 0.5;
const deck = $("deck"); const rail = $("rail"); const railS = $("railS");
const OPEN_BLEND_MS = 650;
let slides = []; let pitch = 1;

const glyph = (k) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${GL[k]}"/></svg>`;
const kindLine = (r, kd) => {
  const date = r.date ? dt(r.date) : r.dlabel || "";
  return `<span>${kd[0]}</span>${date ? `<span class="dt">· ${esc(date)}</span>` : ""}${r.pill ? `<span class="pill">${r.pill}</span>` : ""}`;
};
const statsHTML = (r) => `<dl class="stats">${r.stats.map(([k, v, u]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}${u ? `<small>${esc(u)}</small>` : ""}</dd></div>`).join("")}</dl>`;
function moreHTML(r) {
  let h = `<div class="more"><h3>Record values</h3><dl class="rows">${r.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
  if (r.note) h += `<p class="flag"><b>${esc(r.note[0])}</b>${esc(r.note[1])}</p>`;
  if (r.miss) h += `<p class="flag miss"><b>Not recorded yet</b>${esc(r.miss)}</p>`;
  return `${h}<p class="src mono">noma record ${esc(r.id)} · read ${READ_DATE}</p></div>`;
}
/** Phone: one card per record. */
function slideHTML(id, i) {
  const r = R[id]; const kd = KIND[r.k];
  let h = `<article class="slide" data-i="${i}" aria-roledescription="record" aria-label="${esc(`${kd[0]} ${r.code}`)}"><div class="sumA"><div class="card" style="--k:var(--${kd[1]})">`;
  h += `<p class="kind mono"><i></i>${kindLine(r, kd)}</p>`;
  h += `<h2 class="code">${esc(r.code)}</h2><p class="sub">${esc(r.sub)}</p>${statsHTML(r)}</div>`;
  h += '<button class="morebtn" data-more="1"><span class="mo">All record values</span><span class="mc">Collapse</span><svg viewBox="0 0 12 12"><path d="M2.5 7.5 6 4l3.5 3.5"/></svg></button></div>';
  return `${h}${moreHTML(r)}</article>`;
}
/** Desktop: one timeline step per record; the selected one is open. */
function stepHTML(id, i) {
  const r = R[id]; const kd = KIND[r.k];
  const dash = st.levels.length === 1 && VIA[i] === "dash" ? " dash" : "";
  return `<article class="slide step${dash}" data-i="${i}" style="--k:var(--${kd[1]})" aria-roledescription="record"><button class="sh" id="sh${i}" aria-expanded="false" aria-controls="sb${i}"><span class="ic">${glyph(r.k)}</span><span class="tx"><span class="kind mono">${kindLine(r, kd)}</span><span class="tl"><span class="sc mono">${esc(r.code)}</span><span class="ss">${esc(r.sub)}</span></span></span></button><div class="sb" id="sb${i}" role="region" aria-labelledby="sh${i}"><div class="sbi">${statsHTML(r)}${moreHTML(r)}</div></div></article>`;
}

function buildDeck(anim) {
  deck.innerHTML = lvl().items.map(desk() ? stepHTML : slideHTML).join("");
  slides = [...deck.querySelectorAll(".slide")];
  layoutDeck();
  if (anim && !RM()) deck.animate([{ opacity: 0, transform: `translateX(${anim > 0 ? 36 : -36}px)` }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.16,1,.3,1)" });
}
function layoutDeck() {
  st.VW = $("app").clientWidth; st.VH = $("app").clientHeight;
  if (desk()) { deck.style.removeProperty("--cw"); deck.style.removeProperty("--pad"); } else {
    const cw = Math.min(st.VW - 2 * CARD_GUTTER, CARD_MAX); const padX = (st.VW - cw) / 2;
    deck.style.setProperty("--cw", `${cw}px`); deck.style.setProperty("--pad", `${padX}px`);
    pitch = cw + CARD_GAP;
    // every card as tall as the tallest, so the sheet does not jump between cards
    deck.style.setProperty("--cmin", "0px");
    deck.style.setProperty("--cmin", `${Math.max(...slides.map((s) => s.querySelector(".card").offsetHeight))}px`);
  }
  ctx.measureSheet();
}
function readF() { return clamp(deck.scrollLeft / pitch, 0, Math.max(0, slides.length - 1)); }
function scrollToIdx(i, smooth) {
  i = clamp(i, 0, slides.length - 1);
  if (desk()) {
    st.f = i; ctx.dirty();
    if (smooth) { setActive(i); for (const m of ["map", "graph"]) ctx.startBlend(m, OPEN_BLEND_MS); ctx.setHash(); }
    return;
  }
  const b = smooth && !RM() ? "smooth" : "auto";
  deck.scrollTo({ left: i * pitch, behavior: b });
  if (b === "auto") { st.f = i; ctx.dirty(); }
}
function cardFx(f) {
  if (desk()) return;
  const lo = Math.max(0, Math.floor(f) - 2); const hi = Math.min(slides.length - 1, Math.ceil(f) + 2);
  for (let i = lo; i <= hi; i++) {
    const d = Math.min(1, Math.abs(i - f));
    slides[i].style.transform = `scale(${(1 - d * FAN).toFixed(4)})`;
    slides[i].style.opacity = (1 - d * FADE).toFixed(3);
  }
}

/* ---------- rail: where in the chain, draggable ---------- */
let railX = []; let railLit = null; let railKnob = null; let railDots = [];
const RAIL_Y = 17; const RAIL_PAD = 15; const DENSE = 16; const TILE = 22; const TILE_GLYPH = 0.8;
function buildRail() {
  railS.textContent = "";
  const n = lvl().items.length; const W = rail.clientWidth;
  railX = lvl().items.map((_, i) => (n === 1 ? W / 2 : RAIL_PAD + (i * (W - 2 * RAIL_PAD)) / (n - 1)));
  const main = st.levels.length === 1; const dense = n > DENSE;
  const base = mk("g", {}, railS); const lit = mk("g", {}, railS);
  const clipId = `rc${Math.random().toString(36).slice(2, 7)}`;
  railLit = mk("rect", { x: 0, y: 0, height: 2 * RAIL_Y, width: 0 }, mk("clipPath", { id: clipId }, railS));
  lit.setAttribute("clip-path", `url(#${clipId})`);
  for (let i = 0; i < n - 1; i++) {
    const dash = main && VIA[i] === "dash" ? " dash" : "";
    mk("line", { class: `r-base${dash}`, x1: railX[i], x2: railX[i + 1], y1: RAIL_Y, y2: RAIL_Y }, base);
    mk("line", { class: `r-lit${dash}`, x1: railX[i], x2: railX[i + 1], y1: RAIL_Y, y2: RAIL_Y }, lit);
  }
  railDots = railX.map((x, i) => {
    if (dense) return mk("line", { class: "r-tick", x1: x, x2: x, y1: RAIL_Y - 4, y2: RAIL_Y + 4 }, railS);
    const r = R[lvl().items[i]]; const g = mk("g", { class: `r-tile d-${KIND[r.k][1]}` }, railS); const h = TILE / 2;
    mk("rect", { class: "body", x: x - h, y: RAIL_Y - h, width: TILE, height: TILE }, g);
    mk("path", { class: "glyph", d: GL[r.k], "stroke-width": 1.3 / TILE_GLYPH, transform: `translate(${x - 8 * TILE_GLYPH},${RAIL_Y - 8 * TILE_GLYPH}) scale(${TILE_GLYPH})` }, g);
    mk("rect", { class: "ring", x: x - h - 3, y: RAIL_Y - h - 3, width: TILE + 6, height: TILE + 6 }, g);
    return g;
  });
  railKnob = mk("circle", { class: "r-knob", cx: railX[0], cy: RAIL_Y, r: 0 }, railS);
  rail.setAttribute("aria-valuemin", 1); rail.setAttribute("aria-valuemax", n);
}
function railFx(f) {
  if (!railX.length) return;
  const i = Math.min(railX.length - 2, Math.floor(f)); const u = f - Math.max(0, i);
  const x = railX.length === 1 ? railX[0] : railX[Math.max(0, i)] + (railX[Math.min(railX.length - 1, Math.max(0, i) + 1)] - railX[Math.max(0, i)]) * u;
  railLit.setAttribute("width", Math.max(0, x)); railKnob.setAttribute("cx", x);
  const ai = Math.round(f);
  railDots.forEach((d, k) => {
    d.classList.toggle("past", k < ai || (k <= f + 0.001 && k !== ai));
    d.classList.toggle("now", k === ai);
  });
}
function idxFromRail(e) {
  const x = e.clientX - rail.getBoundingClientRect().left; const n = railX.length;
  return n < 2 ? 0 : clamp(((x - railX[0]) / (railX[n - 1] - railX[0])) * (n - 1), 0, n - 1);
}
let railDrag = null;
const scrubTo = (f) => { deck.scrollLeft = f * pitch; };
function railEvents() {
  rail.addEventListener("pointerdown", (e) => { railDrag = { id: e.pointerId }; rail.setPointerCapture(e.pointerId); deck.classList.add("free"); scrubTo(idxFromRail(e)); });
  rail.addEventListener("pointermove", (e) => { if (railDrag) scrubTo(idxFromRail(e)); });
  const end = () => { if (!railDrag) return; railDrag = null; deck.classList.remove("free"); scrollToIdx(Math.round(st.f), true); };
  rail.addEventListener("pointerup", end); rail.addEventListener("pointercancel", end);
  rail.addEventListener("keydown", (e) => {
    const m = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (m) { e.preventDefault(); go(st.ai + m); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(slides.length - 1); }
  });
}

/* ---------- active card ---------- */
function setActive(ai) {
  if (ai === st.ai) return;
  const had = st.ai >= 0;
  st.ai = ai;
  const L = lvl(); const r = R[L.items[ai]]; const n = L.items.length;
  $("pos").innerHTML = `<b>${pad2(ai + 1)} / ${pad2(n)}</b><span>${esc(r.code)}</span>`;
  $("prev").disabled = ai === 0; $("next").disabled = ai === n - 1;
  rail.setAttribute("aria-valuenow", ai + 1);
  rail.setAttribute("aria-valuetext", `${KIND[r.k][0]} ${r.code}, ${ai + 1} of ${n}`);
  slides.forEach((s, i) => {
    s.classList.toggle("on", i === ai); s.classList.toggle("past", i < ai); s.setAttribute("aria-current", i === ai ? "true" : "false");
    s.querySelector(".sh")?.setAttribute("aria-expanded", i === ai);
  });
  if (desk()) slides[ai].scrollIntoView({ block: "nearest", behavior: RM() || !had ? "auto" : "smooth" });
  ctx.light();
  // a visitor who moved the view gets the camera back as soon as they pick another card
  if (had) for (const m of ["map", "graph"]) if (st.free[m]) ctx.startBlend(m, 650);
}
const go = (i) => scrollToIdx(i, true);

/* ---------- levels: a branch is a nested carousel ---------- */
function pushLevel(items, idx, label, fromId) {
  lvl().idx = st.ai;
  st.levels.push({ items, idx, label, from: fromId });
  enterLevel(1);
}
function popTo(depth) {
  if (depth >= st.levels.length - 1) return;
  st.levels.length = depth + 1;
  enterLevel(-1);
}
function enterLevel(dir) {
  const L = lvl();
  st.ai = -1;
  buildDeck(dir); buildRail(); renderCrumb(); ctx.measureSheet();
  for (const m of ["map", "graph"]) { st.cams[m] = null; st.zi[m] = []; ctx.startBlend(m, 680); }
  scrollToIdx(L.idx || 0, false); st.f = L.idx || 0; setActive(Math.round(st.f)); ctx.dirty(); ctx.setHash();
}
function renderCrumb() {
  const c = $("crumb"); const depth = st.levels.length - 1;
  c.hidden = depth === 0;
  if (!depth) { c.innerHTML = ""; return; }
  const parent = st.levels[depth - 1]; const pr = R[parent.items[parent.idx]];
  let h = `<button class="bk" id="cbk" aria-label="Back to ${esc(pr.code)}"><svg viewBox="0 0 14 14"><path d="M8.5 3 4.5 7l4 4"/></svg>${esc(pr.code)}</button><ol>`;
  st.levels.forEach((L, i) => {
    h += i === depth ? `<li>${esc(L.label)}</li>` : `<li><button data-depth="${i}">${i === 0 ? "Chain" : esc(L.label)}</button></li>`;
  });
  c.innerHTML = `${h}</ol>`;
  $("cbk").addEventListener("click", () => popTo(depth - 1));
  c.querySelectorAll("[data-depth]").forEach((b) => b.addEventListener("click", () => popTo(+b.dataset.depth)));
}
function openBranch(fromId, br) {
  const start = br.ids.includes(fromId) ? br.ids.indexOf(fromId) : Math.max(0, br.ids.findIndex((x) => CHAIN.includes(x)));
  if (st.levels.length > MAX_DEPTH) st.levels.splice(1, st.levels.length - MAX_DEPTH);
  pushLevel(br.ids, start, br.label, fromId);
}
/** Select any record, from the map or the graph. */
function goRecord(id) {
  if (!R[id]) return;
  const i = lvl().items.indexOf(id);
  if (i >= 0) { go(i); return; }
  const ci = CHAIN.indexOf(id);
  if (ci >= 0) {
    st.levels[0].idx = ci;
    if (st.levels.length > 1) { st.levels.length = 1; enterLevel(-1); } else go(ci);
    return;
  }
  const sib = SIBLINGS[R[id].k];
  pushLevel(sib, sib.indexOf(id), sibLabel(R[id].k, sib.length), lvl().items[st.ai]);
}

function events() {
  deck.addEventListener("click", (e) => {
    if (e.target.closest("[data-more]")) { ctx.setSnap(st.snap === "full" ? "mid" : "full"); return; }
    const s = e.target.closest(".slide");
    if (s && +s.dataset.i !== st.ai) go(+s.dataset.i);
  });
  let settleTimer = 0;
  deck.addEventListener("scroll", () => {
    if (desk()) return;
    st.f = readF(); ctx.dirty();
    clearTimeout(settleTimer); settleTimer = setTimeout(() => { ctx.setHash(); if (st.snap !== "full") { const s = slides[st.ai]; if (s) s.scrollTop = 0; } }, SNAP_REST_MS);
  }, { passive: true });
  $("prev").addEventListener("click", () => go(st.ai - 1));
  $("next").addEventListener("click", () => go(st.ai + 1));
  railEvents();
}

export function mount() {
  events();
  Object.assign(ctx, { pitch: () => pitch, buildDeck, layoutDeck, buildRail, railFx, cardFx, setActive, scrollToIdx, go, pushLevel, popTo, enterLevel, openBranch, goRecord, slidesCount: () => slides.length, slideAt: (i) => slides[i] });

}
