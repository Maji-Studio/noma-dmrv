// Basemap loading shared by the Home hero map and the Journey map (style, blank style and timeout live in
// ../config.js). Resolves when the real style loads, or once the blank fallback style is in place.
import { BASEMAP_BLANK_STYLE, BASEMAP_STYLE_TIMEOUT_MS } from "../config.js";

/**
 * One timer (BASEMAP_STYLE_TIMEOUT_MS) that is not cleared on "styledata": the Journey page races map
 * start against an outer deadline (journey/app.js, 12 s) and discards a late map, so this must settle
 * within 8 s even when the style parsed but its tiles hang. A pre-parse error falls back at once.
 * `onBlank` runs when falling back.
 */
export function loadBasemapOrBlank(map, onBlank) {
  return new Promise((resolve) => {
    let settled = false;
    let parsed = false;
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
      onBlank?.();
      map.once("style.load", resolve);
      // diff: false, or an already-parsed style takes the diff path, which never emits "style.load"
      map.setStyle(BASEMAP_BLANK_STYLE, { diff: false });
    };
    const onLoad = () => { cleanup(); resolve(); };
    const onStyleData = () => { parsed = true; };
    const onError = () => { if (!parsed) fallBack(); }; // a style fetch failure; later errors are tiles
    const timer = setTimeout(fallBack, BASEMAP_STYLE_TIMEOUT_MS);
    map.once("styledata", onStyleData);
    map.on("error", onError);
    map.once("load", onLoad);
  });
}
