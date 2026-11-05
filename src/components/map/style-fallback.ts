/**
 * Basemap outage guard shared by the map surfaces. maplibre only throws on a
 * failed WebGL init, not on a failed style fetch, so a provider outage leaves
 * the map without a "load" event and everything that waits on it never starts.
 * This arms a timeout plus a pre-parse error listener; on either it swaps in
 * the blank style (once) and tells the caller, so markers and legs still draw.
 * The first timer only covers a style that never parses. Once "styledata"
 * fires it is swapped for a longer backstop (BASEMAP_LOAD_BACKSTOP_MS) for a
 * style whose TileJSON or tiles hang so that "load" never comes.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import {
  BASEMAP_LOAD_BACKSTOP_MS,
  BASEMAP_STYLE_TIMEOUT_MS,
  BLANK_BASEMAP_STYLE,
} from "@/config/geo";

/**
 * Returns a disposer. `onFallback` runs at most once, right after
 * `setStyle(blank)`. Load success disarms everything.
 */
export function armBasemapFallback(
  map: MapLibreMap,
  onFallback: () => void,
  timeoutMs: number = BASEMAP_STYLE_TIMEOUT_MS,
  backstopMs: number = BASEMAP_LOAD_BACKSTOP_MS,
): () => void {
  let settled = false;
  let styleParsed = false;

  const cleanup = () => {
    settled = true;
    clearTimeout(timer);
    clearTimeout(backstop);
    map.off("load", onLoad);
    map.off("styledata", onStyleData);
    map.off("error", onError);
  };
  const fallBack = () => {
    if (settled) return;
    cleanup();
    // diff: false, or an already-parsed style takes the diff path, which never emits "style.load".
    map.setStyle(BLANK_BASEMAP_STYLE, { diff: false });
    onFallback();
  };
  const onLoad = () => cleanup();
  // An error before the style JSON parses is the style fetch failing. After
  // that it is a transient tile error and "load" still fires.
  const onStyleData = () => {
    styleParsed = true;
    clearTimeout(timer);
    // Parsed, but TileJSON or tiles may still hang: a longer backstop.
    backstop = setTimeout(fallBack, backstopMs);
  };
  const onError = () => {
    if (!styleParsed) fallBack();
  };
  const timer = setTimeout(fallBack, timeoutMs);
  let backstop: ReturnType<typeof setTimeout> | undefined;

  map.once("load", onLoad);
  map.once("styledata", onStyleData);
  map.on("error", onError);
  return cleanup;
}
