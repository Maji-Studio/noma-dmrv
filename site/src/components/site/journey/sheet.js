// Journey page: the bottom sheet that holds the carousel on a phone (peek, half, full), its drag
// handling, and the vertical-drag-on-a-card gesture. On desktop the sheet is a side panel and none
// of this runs. The map owns its own gestures; the sheet only reacts to drags that start on it.
import { clamp } from "./format.js";
import { $, ctx, desk, st } from "./state.js";

const MID_MAX = 0.62; // half-open sheet never covers more than this share of the screen
const PEEK_BODY = 64; // px of card showing when the sheet is lowered
const HEAD_GAP = 6;
const MID_GAP = 4;
const CTRL_GAP = 12;
const HIDE_CTRLS_AT = 0.66;
const HIDE_NOTE_AT = 0.5;
const OVERSHOOT = 0.7;
const FLING = 0.45; // px per ms
const FLING_LOOK = 220; // ms of velocity projected ahead
const FLING_SNAP_SLACK = 10;
const DRAG_START = 4;
const AXIS_START = 6;
const AXIS_BIAS = 1.2;
const PULL_START = 8;
const PULL_BIAS = 1.3;
const MOUSE_FLING = 0.3;
const sheet = $("sheet"); const head = $("head"); const deck = $("deck"); const app = $("app");
let sheetH = 0;
let snapY = { low: 0, mid: 0, full: 0 };
let sd = null; // an active sheet drag
let dragEndT = 0;

function measureSheet() {
  if (desk()) { sheetH = st.VH; return; }
  sheetH = sheet.offsetHeight;
  const s0 = ctx.slideAt(st.ai >= 0 ? st.ai : 0) || ctx.slideAt(0);
  const sumH = s0 ? s0.querySelector(".sumA").offsetHeight : 240;
  const hh = head.offsetHeight;
  const midVis = Math.min(hh + HEAD_GAP + sumH + MID_GAP, st.VH * MID_MAX);
  const lowVis = hh + HEAD_GAP + PEEK_BODY;
  snapY = { full: 0, mid: Math.max(0, sheetH - midVis), low: Math.max(0, sheetH - lowVis) };
  applySnap(!st.booting && !sd);
}
/** px of the screen the sheet covers from the bottom (the camera keeps the target above it). */
function sheetVisible() {
  if (desk()) return 0;
  return sheetH - snapY[st.snap === "low" ? "low" : "mid"];
}
function applySnap(animate) {
  if (desk()) return;
  sheet.classList.toggle("full", st.snap === "full");
  setSY(snapY[st.snap], animate);
  $("grab").setAttribute("aria-label", st.snap === "full" ? "Collapse record values" : "Show all record values");
}
function setSY(y, animate) {
  for (const n of [sheet, $("ctrls"), $("vnote")]) n.classList.toggle("drag", !animate);
  sheet.style.setProperty("--sy", `${y}px`);
  const vis = sheetH - y;
  app.style.setProperty("--cb", `${vis + CTRL_GAP}px`);
  $("ctrls").classList.toggle("off", vis > st.VH * HIDE_CTRLS_AT);
  app.classList.toggle("sheet-high", vis > st.VH * HIDE_CTRLS_AT);
  $("vnote").classList.toggle("off", vis > st.VH * HIDE_CTRLS_AT || vis > st.VH * HIDE_NOTE_AT);
}
function setSnap(s) {
  const prev = st.snap;
  st.snap = s; applySnap(true);
  const cards = [...Array(ctx.slidesCount()).keys()].map(ctx.slideAt);
  cards.forEach((x, i) => { if (s !== "full" || i !== st.ai) x.scrollTop = 0; });
  // the camera only refits when the visible map area changes (peek versus the rest)
  const changed = ((prev === "low") !== (s === "low") && s !== "full" && prev !== "full") || (prev === "full" && s === "low") || (prev === "low" && s === "full");
  if (changed) ctx.invalidate(true);
  ctx.setHash();
}

/* ----- drag the head, or drag vertically on a card ----- */
function sdStart(e) {
  const now = performance.now();
  sd = { y: e.clientY, x: e.clientX, y0: snapY[st.snap], v: 0, ly: e.clientY, lt: now, active: false, id: e.pointerId };
}
function sdMove(clientY) {
  const now = performance.now(); let y = sd.y0 + (clientY - sd.y);
  if (y < 0) y = -((-y) ** OVERSHOOT);
  if (y > snapY.low) y = snapY.low + (y - snapY.low) ** OVERSHOOT;
  sd.v = 0.8 * ((clientY - sd.ly) / Math.max(1, now - sd.lt)) + 0.2 * sd.v;
  sd.ly = clientY; sd.lt = now;
  setSY(y, false);
}
function sdEnd(clientY) {
  const y = sd.y0 + (clientY - sd.y); const proj = y + sd.v * FLING_LOOK; const order = ["full", "mid", "low"];
  let best = "mid"; let bd = 1e9;
  for (const k of order) { const d = Math.abs(snapY[k] - proj); if (d < bd) { bd = d; best = k; } }
  if (Math.abs(sd.v) > FLING) {
    const dir = sd.v > 0 ? 1 : -1; const j = clamp(order.indexOf(st.snap) + dir, 0, 2);
    if ((dir > 0 && snapY[order[j]] >= y - FLING_SNAP_SLACK) || (dir < 0 && snapY[order[j]] <= y + FLING_SNAP_SLACK)) best = order[j];
  }
  sd = null; setSnap(best);
}
function headEvents() {
  head.addEventListener("pointerdown", (e) => { if (desk() || e.target.closest(".nav,.crumb,.rail")) return; sdStart(e); });
  head.addEventListener("pointermove", (e) => {
    if (!sd) return;
    if (!sd.active && Math.abs(e.clientY - sd.y) > DRAG_START) { sd.active = true; try { head.setPointerCapture(e.pointerId); } catch { /* capture is best effort */ } }
    if (sd.active) sdMove(e.clientY);
  });
  head.addEventListener("pointerup", (e) => { if (!sd) return; if (sd.active) { sdEnd(e.clientY); dragEndT = performance.now(); } else sd = null; });
  head.addEventListener("pointercancel", () => { if (sd) { sd = null; applySnap(true); } });
  $("grab").addEventListener("click", () => { if (performance.now() - dragEndT < 350) return; setSnap(st.snap === "full" ? "mid" : st.snap === "low" ? "mid" : "full"); });
}
// Touch scrolls the deck sideways natively (touch-action: pan-x), so a vertical drag arrives as pointer
// events and moves the sheet; a mouse also drags the deck sideways by hand.
let dd = null;
function deckEvents() {
  deck.addEventListener("pointerdown", (e) => {
    if (desk() || e.target.closest("button")) return;
    dd = { x: e.clientX, y: e.clientY, sl: deck.scrollLeft, mouse: e.pointerType === "mouse", axis: null, id: e.pointerId, lx: e.clientX, lt: performance.now(), v: 0 };
  });
  deck.addEventListener("pointermove", (e) => {
    if (!dd) return;
    const dx = e.clientX - dd.x; const dy = e.clientY - dd.y;
    if (!dd.axis && Math.hypot(dx, dy) > AXIS_START) {
      dd.axis = Math.abs(dy) > Math.abs(dx) * AXIS_BIAS ? "y" : "x";
      if (dd.axis === "y" && st.snap !== "full") { sdStart({ clientY: dd.y, clientX: dd.x, pointerId: dd.id }); sd.active = true; try { deck.setPointerCapture(dd.id); } catch { /* best effort */ } }
      else if (dd.axis === "x" && dd.mouse) { deck.classList.add("free"); try { deck.setPointerCapture(dd.id); } catch { /* best effort */ } }
      else if (dd.axis === "y") { dd = null; return; }
    }
    if (dd.axis === "y" && sd) sdMove(e.clientY);
    if (dd.axis === "x" && dd.mouse) {
      const now = performance.now();
      dd.v = 0.8 * ((e.clientX - dd.lx) / Math.max(1, now - dd.lt)) + 0.2 * dd.v; dd.lx = e.clientX; dd.lt = now;
      deck.scrollLeft = dd.sl - dx;
    }
  });
  const end = (e) => {
    if (!dd) return;
    if (dd.axis === "y" && sd) sdEnd(e.clientY);
    if (dd.axis === "x" && dd.mouse) {
      const f = deck.scrollLeft / ctx.pitch(); const target = Math.abs(dd.v) > MOUSE_FLING ? (dd.v < 0 ? Math.ceil(f) : Math.floor(f)) : Math.round(f);
      deck.classList.remove("free"); dd = null; ctx.go(target); return;
    }
    dd = null;
  };
  deck.addEventListener("pointerup", end);
  deck.addEventListener("pointercancel", (e) => { if (dd && dd.axis === "y" && sd) sdEnd(e.clientY); dd = null; });
  // pulling down from the top of a full card closes the sheet to half
  let td = null;
  deck.addEventListener("touchstart", (e) => {
    if (st.snap !== "full" || desk()) return;
    const s = e.target.closest(".slide");
    td = s && s.scrollTop <= 0 ? { y: e.touches[0].clientY, x: e.touches[0].clientX, on: false } : null;
  }, { passive: true });
  deck.addEventListener("touchmove", (e) => {
    if (!td) return;
    const t = e.touches[0]; const dy = t.clientY - td.y; const dx = t.clientX - td.x;
    if (!td.on) {
      if (dy > PULL_START && dy > Math.abs(dx) * PULL_BIAS) { td.on = true; sdStart({ clientY: td.y, clientX: td.x }); sd.active = true; }
      else if (Math.abs(dx) > PULL_START || dy < -PULL_START) { td = null; return; }
    }
    if (td.on) { e.preventDefault(); sdMove(t.clientY); }
  }, { passive: false });
  deck.addEventListener("touchend", (e) => { if (td && td.on && sd) sdEnd(e.changedTouches[0].clientY); td = null; });
}

export function mount() {
  headEvents(); deckEvents();
  Object.assign(ctx, { measureSheet, sheetVisible, applySnap, setSnap, isDragging: () => !!sd });

}
