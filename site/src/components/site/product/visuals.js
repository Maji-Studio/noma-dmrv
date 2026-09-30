// Mounts the shared bins and map visuals on /product. The bins draw plays once, on first view.
// Narrow screens: the truck stacks under the bins, and the map opens scrolled to the plant.
import { mountVisuals } from "../../../visuals/index.js";
import { onFirstView, reducedMotion } from "../motion.js";

const DRAW_KG = 400; // the visual's default draw
const BINS_WIDE_MIN = 500; // below this art width the truck no longer fits beside the bins

/** Stacks the truck under the bins whenever the art column is too narrow for both side by side. */
function fitBins(bins) {
  const art = bins.querySelector(".nv-scroll");
  if (!art || !("ResizeObserver" in window)) return;
  new ResizeObserver(([entry]) => {
    bins.noma.layout(entry.contentRect.width < BINS_WIDE_MIN ? "stacked" : "wide");
  }).observe(art);
}

/** When the map is wider than its box, scroll it so the plant sits in the middle. */
function centreMap(map) {
  const scroller = map.querySelector(".nv-scroll");
  const plant = map.querySelector('[data-id="plant"]');
  if (!scroller || !plant) return;
  let width = 0;
  const centre = () => {
    if (scroller.clientWidth === width) return;
    width = scroller.clientWidth;
    if (scroller.scrollWidth <= width) return;
    const box = scroller.getBoundingClientRect(), mark = plant.getBoundingClientRect();
    scroller.scrollLeft += mark.left + mark.width / 2 - (box.left + box.width / 2);
  };
  centre();
  if ("ResizeObserver" in window) new ResizeObserver(centre).observe(scroller);
}

export function mountProductVisuals(root = document) {
  root.querySelectorAll("#bins, #map").forEach((section) => mountVisuals(section));
  const map = root.querySelector("#map [data-visual='map']");
  if (map) centreMap(map);
  const bins = root.querySelector("[data-pd-bins]");
  if (!bins?.noma) return;
  fitBins(bins);
  if (reducedMotion() || !("IntersectionObserver" in window)) return;
  bins.noma.set({ D: 0 }); // empty truck until the draw plays
  onFirstView(bins, () => { bins.noma.set({ D: DRAW_KG }); bins.noma.play(); }, { threshold: 0.45 });
}
