// TraceStage record view: a slow timeline. One card shows at a time (.is-active; the rest are inert)
// and the active row carries aria-current="step", which lights its dot. Once the stage plays, the view
// walks the steps in order, one every --ts-dwell, and loops; the active row shows the dwell as a
// growing rail segment (.is-cycling). Selecting a row pauses the walk so the record can be read. A play/pause control
// lets the viewer resume it. It also pauses off screen and in a background tab. Reduced motion or no JS: no walk, the application card stays open and
// rows still switch the view.
import { durationMs, keepInView, reducedMotion } from "../motion.js";

const DEFAULT_DWELL_MS = 3000;
const STACKED = "(max-width: 900px)";

export function initTraceStage(root) {
  const stage = root.closest("[data-reveal]");
  const area = root.querySelector(".ts-stage");
  const rows = [...root.querySelectorAll(".ts-row[data-step]")];
  const steps = rows.map((r) => r.dataset.step);
  const cards = new Map([...root.querySelectorAll(".ts-card")].map((c) => [c.dataset.step, c]));
  const dwell = durationMs(getComputedStyle(root).getPropertyValue("--ts-dwell"), DEFAULT_DWELL_MS);
  let current = rows.find((r) => r.querySelector("[aria-current]"))?.dataset.step;
  let timer = 0;
  let started = false;
  let picked = false;    // the viewer chose a step before the stage played
  let onScreen = true;
  let paused = false;
  const pause = root.querySelector(".ts-pause");
  const view = root.querySelector(".ts-view");

  function show(id, plot = true) {
    current = id;
    rows.forEach((r) => {
      const button = r.querySelector("button");
      if (r.dataset.step === id) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    cards.forEach((card, key) => {
      card.classList.toggle("is-active", key === id);
      card.inert = key !== id;
      card.classList.remove("is-plotting");
    });
    if (plot && !reducedMotion()) {
      const card = cards.get(id);
      void card.offsetWidth; // restart the plot animation
      card.classList.add("is-plotting");
    }
  }

  const running = () => started && !paused && !reducedMotion() && onScreen && !document.hidden;

  function schedule() {
    clearTimeout(timer);
    root.classList.toggle("is-cycling", running());
    // Automatic updates should not repeatedly interrupt a screen reader.
    view.setAttribute("aria-live", running() ? "off" : "polite");
    if (!running()) return;
    timer = setTimeout(() => {
      show(steps[(steps.indexOf(current) + 1) % steps.length]);
      schedule();
    }, dwell);
  }

  function pick(id) {
    picked = true;
    paused = true;
    pause.textContent = "Play timeline";
    schedule();
    if (id === current) return;
    show(id);
    schedule(); // a fresh dwell on the picked step
  }
  pause.hidden = reducedMotion();
  pause.addEventListener("click", () => {
    paused = !paused;
    pause.textContent = paused ? "Play timeline" : "Pause timeline";
    schedule();
  });

  rows.forEach((row) => {
    const id = row.dataset.step;
    const button = row.querySelector("button");
    button.addEventListener("focus", () => pick(id));
    button.addEventListener("click", () => {
      pick(id);
      if (matchMedia(STACKED).matches) keepInView(view);
    });
  });
  document.addEventListener("visibilitychange", schedule);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; schedule(); }).observe(area);
  }

  if (!stage || reducedMotion()) return;
  const onState = () => {
    if (started) return;
    if (stage.dataset.reveal === "armed" && !picked) show(steps[0], false);
    if (stage.dataset.reveal === "play") {
      started = true;
      if (!picked) show(steps[0]);
      schedule();
    }
  };
  onState();
  new MutationObserver(onState).observe(stage, { attributes: true, attributeFilter: ["data-reveal"] });
}
