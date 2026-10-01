// Mounts every [data-visual] element inside a root, once. Each element gets `el.noma` (its controller).
//
//   <div data-visual="chain"></div>   simple trace; data-side="right|below|none", data-legend="false"
//   <div data-visual="dense"></div>   six-week graph; data-style="dots|glyphs", data-jump="true", data-side
//   <div data-visual="map"></div>     map; data-side
//   <div data-visual="bins"></div>    bin squares; data-controls="false", data-readout="false"
//   <div data-visual="morph"></div>   registry mapping; data-button="false", data-autoplay="visible"
//
// Trace visuals dispatch a bubbling "noma:select" event: detail = { id, node } (null when cleared).
// Controllers: chain/dense/map → { pin(id), clear() }; bins → { play(), set({mode, D, m}) }; morph → { play() }.
import { mountBins } from "./bins.js";
import { mountMorph } from "./morph.js";
import { mountChain, mountDense, mountMap } from "./traces.js";

const MOUNTS = { chain: mountChain, dense: mountDense, map: mountMap, bins: mountBins, morph: mountMorph };
export function mountVisuals(root = document) {
  root.querySelectorAll("[data-visual]").forEach((node) => {
    if (node.noma) return;
    const fn = MOUNTS[node.dataset.visual];
    if (fn) node.noma = fn(node);
  });
}
export { featIcon } from "./core.js";
export { CHAIN_ORDER } from "./data.js";
