// "What's next" demos (NextShowcase). Each demo plays when its accordion item opens: CSS owns the timed
// parts (data-anim="armed" then "play"), JS adds what CSS cannot do (values flying between cards, messages typing in). Reduced motion, no
// IntersectionObserver or no JS: every demo shows its end state and nothing is ever hidden at rest.
import { motionToken, onFirstView, reducedMotion } from "../motion.js";

const MS = {
  documents: 2300, reactor: 2000, telegram: 3400, connections: 1900, checks: 1900, // total per demo
  flyStart: 350, fly: 750,                       // documents; the gap between values is --stagger-slow
  typeStart: 250, perChar: 26, typing: 750,     // telegram
};

const timers = new WeakMap();
function later(demo, fn, ms) { const t = setTimeout(fn, ms); timers.get(demo).push(t); return t; }

function finish(demo) {
  (timers.get(demo) || []).forEach(clearTimeout);
  timers.set(demo, []);
  demo.querySelectorAll(".nd-flyer").forEach((f) => f.remove());
  demo.querySelectorAll("[data-type]").forEach((p) => { if (p.dataset.full) p.textContent = p.dataset.full; });
  demo.dataset.anim = "done";
}

// documents: each value leaves the ticket and lands in its field on the record.
function flyValues(demo) {
  const gap = parseFloat(motionToken("--stagger-slow")), easing = motionToken("--ease-draw");
  demo.querySelectorAll("[data-fly-to]").forEach((to, i) => {
    const from = demo.querySelector(`[data-fly-from="${to.dataset.flyTo}"]`);
    later(demo, () => {
      const box = demo.getBoundingClientRect(), a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      const flyer = document.createElement("span");
      flyer.className = "nd-flyer";
      flyer.setAttribute("aria-hidden", "true");
      flyer.textContent = to.textContent;
      flyer.style.left = `${a.left - box.left}px`;
      flyer.style.top = `${a.top - box.top}px`;
      demo.append(flyer);
      const dx = b.left - a.left, dy = b.top - a.top;
      const run = flyer.animate(
        [{ transform: "translate(0, 0)" }, { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 28}px)`, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px)` }],
        { duration: MS.fly, easing, fill: "forwards" },
      );
      run.onfinish = () => { to.classList.add("is-in"); flyer.remove(); };
    }, MS.flyStart + i * gap);
  });
}

// telegram: the outgoing message types in, then noma is typing, then its reply appears.
function typeMessages(demo) {
  const out = demo.querySelector("[data-type]");
  const full = out.dataset.full || out.textContent.trim();
  out.dataset.full = full;
  const typed = document.createElement("span"), rest = document.createElement("span");
  rest.className = "nd-rest";
  rest.textContent = full;
  out.replaceChildren(typed, rest);
  [...full].forEach((_, i) => later(demo, () => {
    typed.textContent = full.slice(0, i + 1);
    rest.textContent = full.slice(i + 1);
  }, MS.typeStart + i * MS.perChar));
  const typedAt = MS.typeStart + full.length * MS.perChar;
  later(demo, () => { demo.dataset.anim = "typing"; }, typedAt + 150);
  later(demo, () => { demo.dataset.anim = "play"; demo.classList.add("is-replied"); }, typedAt + 150 + MS.typing);
  return typedAt + 150 + MS.typing + 600;
}

export function playDemo(demo) {
  if (!demo || reducedMotion()) return;
  finish(demo);
  demo.classList.remove("is-replied");
  demo.querySelectorAll(".is-in").forEach((n) => n.classList.remove("is-in"));
  demo.dataset.anim = "armed";
  void demo.offsetWidth; // commit the start state before transitions run
  const kind = demo.dataset.demo;
  let total = MS[kind] || 2000;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    demo.dataset.anim = "play";
    if (kind === "documents") flyValues(demo);
    if (kind === "telegram") total = typeMessages(demo);
    later(demo, () => finish(demo), total);
  }));
}

// Wires the demos to the showcase: the open item's demo plays on first view and whenever an item opens;
// the demo it replaces jumps to its end state.
export function mountNextDemos(root) {
  const demos = [...root.querySelectorAll("[data-demo]")];
  demos.forEach((d) => timers.set(d, []));
  const demoIn = (visual) => visual && visual.querySelector("[data-demo]");
  let current = null;

  function play(demo) {
    if (current && current !== demo) finish(current);
    current = demo;
    playDemo(demo);
  }

  root.addEventListener("accordion:open", (e) => { if (e.detail.visual) play(demoIn(e.detail.visual)); });
  if (reducedMotion() || !("IntersectionObserver" in window)) return;
  onFirstView(root, () => {
    const visual = root.querySelector(".acc-visual[data-shown]") || root.querySelector(".acc-visual");
    if (!current) play(demoIn(visual));
  }, { threshold: 0.2 });
}
