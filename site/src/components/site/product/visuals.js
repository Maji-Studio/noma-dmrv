// Mounts the shared map visual on /product. Narrow screens: the map opens scrolled to the plant.
import { mountVisuals } from "../../../visuals/index.js";

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
  root.querySelectorAll("#map").forEach((section) => mountVisuals(section));
  const map = root.querySelector("#map [data-visual='map']");
  if (map) centreMap(map);
}
