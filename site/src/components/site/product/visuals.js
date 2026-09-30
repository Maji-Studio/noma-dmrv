// Mounts the shared bins and map visuals on /product. The bins draw plays once, on first view.
import { mountVisuals } from "../../../visuals/index.js";
import { onFirstView, reducedMotion } from "../motion.js";

const DRAW_KG = 400; // the visual's default draw

export function mountProductVisuals(root = document) {
  root.querySelectorAll("#bins, #map").forEach((section) => mountVisuals(section));
  const bins = root.querySelector("[data-pd-bins]");
  if (!bins?.noma || reducedMotion() || !("IntersectionObserver" in window)) return;
  bins.noma.set({ D: 0 }); // empty truck until the draw plays
  onFirstView(bins, () => { bins.noma.set({ D: DRAW_KG }); bins.noma.play(); }, { threshold: 0.45 });
}
