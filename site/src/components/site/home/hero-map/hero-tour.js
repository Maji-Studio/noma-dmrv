// Home hero: the map at rest under the copy; "Follow one delivery" enters a scroll tour down the chain.
// At rest the map cycles through tracing each field and sawmill (hover or focus a site to trace it).
// On tour, each step card that reaches the middle of the viewport moves the camera to its stop. The
// tour ends with "Exit tour", Escape, "Back to the map", or by scrolling past the hero.
import { createHeroMap, recordCard, kindOf } from "./map.js";
import { SITES, STOPS, TRACES } from "./data.js";
import { reducedMotion } from "../../motion.js";

const REST_CYCLE_MS = 3800;
const REST_ORDER = ["field-coffee", "sawmill-a", "field-maize", "sawmill-b"];
const WIDE = "(min-width: 761px)"; // matches the 760px breakpoint in hero-map.css
const CLOSE_ZOOM = 12.8; // plant close-up
const CLOSE_PITCH = 50;
const STOP_ZOOM = 11.2;
const STOP_PITCH = 20;
const REST_ZOOM = 11;
const CLEAR = 70; // gap between a card's right edge and what the camera frames
const CARD_CLEAR = 44; // on wide screens the record card sits above its site: its lift (20) plus a margin
const STEP_BAND = "-45% 0px -45% 0px"; // a step is active while it crosses the middle tenth
const ALL = SITES.map((s) => s.id);

export async function initHomeHero(root) {
  const container = root.querySelector("[data-hero-map]");
  const steps = [...root.querySelectorAll("[data-step]")];
  const stops = [...root.querySelectorAll("[data-jump]")];
  const panel = root.querySelector(".home-hero-panel");
  const firstCard = root.querySelector(".home-hero-card");
  const wide = () => matchMedia(WIDE).matches;
  const edge = (node) => node.getBoundingClientRect().right - root.getBoundingClientRect().left + CLEAR;
  // At rest the copy covers the left (wide) or the top (narrow); on tour the cards do.
  const restPadding = () => (wide() ? { top: 200, bottom: 110, left: edge(panel), right: 300 } : { top: Math.round(innerHeight * 0.55), bottom: 70, left: 50, right: 110 });
  // cardH: the open record card's height, so its site sits low enough for the card to fit above it.
  const tourPadding = (cardH = 0) => (wide() ? { top: Math.max(110, cardH + CARD_CLEAR), bottom: 120, left: edge(firstCard), right: 320 } : { top: 80, bottom: Math.round(innerHeight * 0.45), left: 40, right: 110 });

  root.classList.add("has-js");
  let touring = false;

  // On tour the map is 100svh and pinned: keep its legend strip above the fold while the header shows.
  const onScroll = () => root.style.setProperty("--hero-lift", `${touring ? Math.max(0, root.getBoundingClientRect().top) : 0}px`);
  addEventListener("scroll", onScroll, { passive: true });

  const smooth = () => (reducedMotion() ? "auto" : "smooth");
  const jump = (k) => steps[k].scrollIntoView({ behavior: smooth(), block: k === 0 ? "start" : "center" });
  const openBtn = root.querySelector("[data-tour-open]");

  function enter() {
    touring = true;
    root.classList.add("is-touring");
    onScroll();
    requestAnimationFrame(() => {
      jump(1);
      steps[1].querySelector("h2")?.focus({ preventScroll: true });
    });
  }
  /** Leave the tour. keepPlace: the reader scrolled past, so collapse without moving what they see. */
  function exit({ keepPlace = false } = {}) {
    // Collapsing the tour shortens the page and the browser clamps the scroll; restore it ourselves,
    // with scroll anchoring off so it does not correct a second time.
    const y = scrollY;
    const tall = root.offsetHeight;
    const html = document.documentElement;
    html.style.overflowAnchor = "none";
    touring = false;
    root.classList.remove("is-touring");
    onScroll();
    if (keepPlace) scrollTo({ top: y - (tall - root.offsetHeight), behavior: "instant" });
    else {
      scrollTo({ top: 0, behavior: "instant" }); // the hero is the page's first section
      openBtn.focus({ preventScroll: true });
    }
    requestAnimationFrame(() => { html.style.overflowAnchor = ""; });
    steps.forEach((st, n) => st.classList.toggle("is-active", n === 0));
    go(0);
  }
  openBtn.addEventListener("click", enter);
  root.querySelectorAll("[data-tour-exit]").forEach((b) => b.addEventListener("click", () => exit()));
  stops.forEach((b, k) => b.addEventListener("click", () => jump(k)));
  addEventListener("keydown", (e) => { if (touring && e.key === "Escape") exit(); });
  // Scrolled past the whole tour: close it, so coming back up finds the plain map again.
  new IntersectionObserver(([entry]) => {
    if (touring && !entry.isIntersecting && entry.boundingClientRect.bottom <= 0) exit({ keepPlace: true });
  }).observe(root);

  let resting = true;
  let hovering = false;
  let current = 0;
  let i = 0;
  let h = null;
  function trace(id) { h.highlight(TRACES[id]); h.openCard(id); }

  /** The step card's drawing, copied for the map's record card; ids renamed so they stay unique. */
  function cardArt(step) {
    const art = step.querySelector(".contour-art");
    if (!art) return undefined;
    const copy = art.cloneNode(true);
    copy.setAttribute("class", "contour-art");
    for (const node of copy.querySelectorAll("[id]")) node.id = `card-${node.id}`;
    for (const use of copy.querySelectorAll("use")) use.setAttribute("href", `#card-${use.getAttribute("href").slice(1)}`);
    return copy;
  }

  function go(k) {
    current = k;
    resting = k === 0;
    root.classList.toggle("is-resting", resting);
    if (!h) return;
    if (resting) {
      h.frame(ALL, { padding: restPadding(), zoom: REST_ZOOM });
      trace(REST_ORDER[i % REST_ORDER.length]);
      return;
    }
    const stop = STOPS[k - 1];
    h.highlight(stop.lit);
    h.openCard(stop.at, stop.card ? recordCard({ kind: kindOf(stop.at), type: stop.label, code: stop.records.join(", "), rows: stop.card, art: cardArt(steps[k]) }) : undefined);
    const cardH = container.querySelector(".hm-pop")?.offsetHeight ?? 0;
    h.frame(stop.focus, { padding: tourPadding(cardH), zoom: stop.close ? CLOSE_ZOOM : stop.end ? REST_ZOOM : STOP_ZOOM, pitch: stop.close ? CLOSE_PITCH : stop.end ? 0 : STOP_PITCH });
  }

  // Steps and stops work without the map (no WebGL, no key): the cards are the content.
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const k = steps.indexOf(entry.target);
      // The active card runs its drawing's loops; becoming active plots the drawing in (contour-art.css).
      steps.forEach((s, n) => { s.classList.toggle("is-active", n === k); s.classList.remove("is-plotting"); });
      if (!reducedMotion()) { void steps[k].offsetWidth; steps[k].classList.add("is-plotting"); }
      stops.forEach((b, n) => (n === k ? b.setAttribute("aria-current", "step") : b.removeAttribute("aria-current")));
      go(k);
    }
  }, { rootMargin: STEP_BAND });
  steps.forEach((s) => io.observe(s));

  h = await createHeroMap(container, {
    padding: restPadding(),
    card: wide() ? { anchor: "bottom-left", offset: [12, -20] } : undefined, // up and right, clear of the site label
    onSite(id, e) {
      if (!resting) return;
      if (e.type === "mouseenter" || e.type === "focus") { hovering = true; trace(id); }
      if (e.type === "mouseleave" || e.type === "blur") hovering = false;
    },
  });
  if (!h) return;
  root.classList.add("has-map");
  go(current);
  setInterval(() => { if (resting && !hovering) trace(REST_ORDER[++i % REST_ORDER.length]); }, REST_CYCLE_MS);

  addEventListener("resize", () => { if (resting) h.frame(ALL, { padding: restPadding(), zoom: REST_ZOOM, animate: false }); });
}
