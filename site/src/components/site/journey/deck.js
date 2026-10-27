// Journey page: the record carousel (cards), the rail above it, and branch levels. The cards are the
// page's main control: swiping moves st.f, and the map and graph cameras follow it (camera.js).
import { CHAIN, KIND, R, READ_DATE, SIBLINGS, VIA, sibLabel } from "./model.js";
import { clamp, dt, esc, pad2 } from "./format.js";
import { $, RM, ctx, desk, lvl, mk, st } from "./state.js";

const CARD_MAX = 460;
const CARD_GUTTER = 56; // px of the next card that shows at the edge
const CARD_GAP = 10;
const SNAP_REST_MS = 140;
const MAX_DEPTH = 4;
const FAN = 0.05; // how much a card shrinks as it leaves the centre
const FADE = 0.5;
const DESK_FADE = 0.42;
const deck = $("deck"); const rail = $("rail"); const railS = $("railS");
const ARROW = {
  up: '<svg viewBox="0 0 12 12"><path d="M6 10V2M2.5 5.5 6 2l3.5 3.5"/></svg>',
  down: '<svg viewBox="0 0 12 12"><path d="M6 2v8M2.5 6.5 6 10l3.5-3.5"/></svg>',
  peer: '<svg viewBox="0 0 12 12"><path d="M1.5 6h9M7.5 3l3 3-3 3"/></svg>',
};
const DIRL = { up: "Came from", down: "Went to", peer: "Same step" };
let slides = []; let pitch = 1; let tops = [];

function slideHTML(id, i) {
  const r = R[id]; const kd = KIND[r.k];
  const date = r.date ? dt(r.date) : r.dlabel || "";
  let h = `<article class="slide" data-i="${i}" aria-roledescription="record" aria-label="${esc(`${kd[0]} ${r.code}`)}"><div class="sumA"><div class="card" style="--k:var(--${kd[1]})">`;
  h += `<p class="kind mono"><i></i><span>${kd[0]}</span>${date ? `<span class="dt">· ${esc(date)}</span>` : ""}${r.pill ? `<span class="pill">${r.pill}</span>` : ""}</p>`;
  h += `<h2 class="code">${esc(r.code)}</h2><p class="sub">${esc(r.sub)}</p>`;
  h += `<dl class="stats">${r.stats.map(([k, v, u]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}${u ? `<small>${esc(u)}</small>` : ""}</dd></div>`).join("")}</dl></div>`;
  const brs = r.br.filter((b) => !b.ids.every((x) => x === id)).slice(0, 3);
  h += `<div class="br">${brs.map((b) => `<button class="bchip" data-b="${r.br.indexOf(b)}" aria-label="${esc(`${DIRL[b.dir]}: ${b.label}`)}">${ARROW[b.dir]}<span>${esc(b.label)}</span></button>`).join("")}</div>`;
  h += '<button class="morebtn" data-more="1"><span class="mo">All record values</span><span class="mc">Collapse</span><svg viewBox="0 0 12 12"><path d="M2.5 7.5 6 4l3.5 3.5"/></svg></button></div>';
  h += `<div class="more"><h3>Record values</h3><dl class="rows">${r.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
  if (r.note) h += `<p class="flag"><b>${esc(r.note[0])}</b>${esc(r.note[1])}</p>`;
  if (r.miss) h += `<p class="flag miss"><b>Not recorded yet</b>${esc(r.miss)}</p>`;
  return `${h}<p class="src mono">noma record ${esc(r.id)} · read ${READ_DATE}</p></div></article>`;
}

function buildDeck(anim) {
  deck.innerHTML = lvl().items.map(slideHTML).join("") + (desk() ? '<div class="deckpad" id="deckpad"></div>' : "");
  slides = [...deck.querySelectorAll(".slide")];
  layoutDeck();
  if (anim && !RM()) deck.animate([{ opacity: 0, transform: `translateX(${anim > 0 ? 36 : -36}px)` }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.16,1,.3,1)" });
}
function layoutDeck() {
  st.VW = $("app").clientWidth; st.VH = $("app").clientHeight;
  if (desk()) {
    deck.style.removeProperty("--cw"); deck.style.removeProperty("--pad");
    tops = slides.map((s) => s.offsetTop - slides[0].offsetTop);
    const padEl = $("deckpad");
    if (padEl) padEl.style.height = `${Math.max(0, deck.clientHeight - slides[slides.length - 1].offsetHeight - 30)}px`;
  } else {
    const cw = Math.min(st.VW - 2 * CARD_GUTTER, CARD_MAX); const padX = (st.VW - cw) / 2;
    deck.style.setProperty("--cw", `${cw}px`); deck.style.setProperty("--pad", `${padX}px`);
    pitch = cw + CARD_GAP;
    // every card as tall as the tallest, so the sheet does not jump between cards
    deck.style.setProperty("--cmin", "0px");
    deck.style.setProperty("--cmin", `${Math.max(...slides.map((s) => s.querySelector(".card").offsetHeight))}px`);
    deck.style.setProperty("--smin", "0px");
    deck.style.setProperty("--smin", `${Math.max(...slides.map((s) => s.querySelector(".sumA").offsetHeight))}px`);
  }
  ctx.measureSheet();
}
function readF() {
  const n = slides.length; if (!n) return 0;
  if (desk()) {
    const y = deck.scrollTop; let i = 0;
    while (i < n - 1 && tops[i + 1] <= y) i++;
    if (i >= n - 1) return n - 1;
    return clamp(i + (y - tops[i]) / Math.max(1, tops[i + 1] - tops[i]), 0, n - 1);
  }
  return clamp(deck.scrollLeft / pitch, 0, n - 1);
}
function scrollToIdx(i, smooth) {
  i = clamp(i, 0, slides.length - 1);
  const b = smooth && !RM() ? "smooth" : "auto";
  if (desk()) deck.scrollTo({ top: tops[i], behavior: b }); else deck.scrollTo({ left: i * pitch, behavior: b });
  if (b === "auto") { st.f = i; ctx.dirty(); }
}
function cardFx(f) {
  if (desk()) { slides.forEach((s, i) => { s.style.opacity = 1 - Math.min(1, Math.abs(i - f)) * DESK_FADE; }); return; }
  const lo = Math.max(0, Math.floor(f) - 2); const hi = Math.min(slides.length - 1, Math.ceil(f) + 2);
  for (let i = lo; i <= hi; i++) {
    const d = Math.min(1, Math.abs(i - f));
    slides[i].style.transform = `scale(${(1 - d * FAN).toFixed(4)})`;
    slides[i].style.opacity = (1 - d * FADE).toFixed(3);
  }
}

/* ---------- rail: where in the chain, draggable ---------- */
let railX = []; let railLit = null; let railKnob = null; let railDots = [];
const RAIL_Y = 15; const RAIL_PAD = 12; const DENSE = 16;
function buildRail() {
  railS.textContent = "";
  const n = lvl().items.length; const W = rail.clientWidth;
  railX = lvl().items.map((_, i) => (n === 1 ? W / 2 : RAIL_PAD + (i * (W - 2 * RAIL_PAD)) / (n - 1)));
  const main = st.levels.length === 1; const dense = n > DENSE;
  const base = mk("g", {}, railS); const lit = mk("g", {}, railS);
  const clipId = `rc${Math.random().toString(36).slice(2, 7)}`;
  railLit = mk("rect", { x: 0, y: 0, height: 36, width: 0 }, mk("clipPath", { id: clipId }, railS));
  lit.setAttribute("clip-path", `url(#${clipId})`);
  const via = VIA;
  for (let i = 0; i < n - 1; i++) {
    const dash = main && via[i] === "dash" ? " dash" : "";
    mk("line", { class: `r-base${dash}`, x1: railX[i], x2: railX[i + 1], y1: RAIL_Y, y2: RAIL_Y }, base);
    mk("line", { class: `r-lit${dash}`, x1: railX[i], x2: railX[i + 1], y1: RAIL_Y, y2: RAIL_Y }, lit);
  }
  railDots = railX.map((x) => (dense ? mk("line", { class: "r-tick", x1: x, x2: x, y1: RAIL_Y - 4, y2: RAIL_Y + 4 }, railS) : mk("circle", { class: "r-dot", cx: x, cy: RAIL_Y, r: 4 }, railS)));
  railKnob = mk("circle", { class: "r-knob", cx: railX[0], cy: RAIL_Y, r: 2.4 }, railS);
  if (main) {
    mk("text", { class: "r-end", x: RAIL_PAD - 4, y: 34 }, railS).textContent = "UPSTREAM";
    mk("text", { class: "r-end", x: W - RAIL_PAD + 4, y: 34, "text-anchor": "end" }, railS).textContent = "DOWNSTREAM";
  }
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
    if (d.tagName === "circle") d.setAttribute("r", k === ai ? 5.5 : 3.6);
  });
}
function idxFromRail(e) {
  const x = e.clientX - rail.getBoundingClientRect().left; const n = railX.length;
  return n < 2 ? 0 : clamp(((x - railX[0]) / (railX[n - 1] - railX[0])) * (n - 1), 0, n - 1);
}
let railDrag = null;
function scrubTo(f) {
  if (desk()) { const i = Math.min(tops.length - 2, Math.floor(f)); deck.scrollTop = tops[i] + (tops[i + 1] - tops[i]) * (f - i); } else deck.scrollLeft = f * pitch;
}
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
  slides.forEach((s, i) => { s.classList.toggle("on", i === ai); s.setAttribute("aria-current", i === ai ? "true" : "false"); });
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
    const b = e.target.closest(".bchip");
    if (b) { const r = R[lvl().items[+b.closest(".slide").dataset.i]]; openBranch(r.id, r.br[+b.dataset.b]); return; }
    if (e.target.closest("[data-more]")) { ctx.setSnap(st.snap === "full" ? "mid" : "full"); return; }
    const s = e.target.closest(".slide");
    if (s && +s.dataset.i !== st.ai) go(+s.dataset.i);
  });
  let settleTimer = 0;
  deck.addEventListener("scroll", () => {
    st.f = readF(); ctx.dirty();
    clearTimeout(settleTimer); settleTimer = setTimeout(() => { ctx.setHash(); if (!desk() && st.snap !== "full") { const s = slides[st.ai]; if (s) s.scrollTop = 0; } }, SNAP_REST_MS);
  }, { passive: true });
  $("prev").addEventListener("click", () => go(st.ai - 1));
  $("next").addEventListener("click", () => go(st.ai + 1));
  railEvents();
}

export function mount() {
  events();
  Object.assign(ctx, { pitch: () => pitch, buildDeck, layoutDeck, buildRail, railFx, cardFx, setActive, scrollToIdx, go, pushLevel, popTo, enterLevel, openBranch, goRecord, slidesCount: () => slides.length, slideAt: (i) => slides[i] });

}
