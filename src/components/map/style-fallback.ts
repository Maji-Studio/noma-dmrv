/**
 * Basemap outage guard shared by the map surfaces. maplibre only throws on a
 * failed WebGL init, not on a failed style fetch, so a provider outage leaves
 * the map without a "load" event and everything that waits on it never starts.
 * This arms a timeout plus a pre-parse error listener; on either it swaps in
 * the blank style (once) and tells the caller, so markers and legs still draw.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { BASEMAP_STYLE_TIMEOUT_MS, BLANK_BASEMAP_STYLE } from "@/config/geo";

/**
 * Returns a disposer. `onFallback` runs at most once, right after
 * `setStyle(blank)`. Load success disarms everything.
 */
export function armBasemapFallback(
  map: MapLibreMap,
  onFallback: () => void,
  timeoutMs: number = BASEMAP_STYLE_TIMEOUT_MS,
): () => void {
  let settled = false;
  let styleParsed = false;

  const cleanup = () => {
    settled = true;
    clearTimeout(timer);
    map.off("load", onLoad);
    map.off("styledata", onStyleData);
    map.off("error", onError);
  };
  const fallBack = () => {
    if (settled) return;
    cleanup();
    map.setStyle(BLANK_BASEMAP_STYLE);
    onFallback();
  };
  const onLoad = () => cleanup();
  // An error before the style JSON parses is the style fetch failing. After
  // that it is a transient tile error and "load" still fires.
  const onStyleData = () => {
    styleParsed = true;
  };
  const onError = () => {
    if (!styleParsed) fallBack();
  };
  const timer = setTimeout(fallBack, timeoutMs);

  map.once("load", onLoad);
  map.once("styledata", onStyleData);
  map.on("error", onError);
  return cleanup;
}
