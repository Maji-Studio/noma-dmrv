/**
 * Keeps E2E hermetic: the app's basemap is the OpenFreeMap style on
 * tiles.openfreemap.org (src/config/geo.ts → BASEMAP_STYLE_URL). CI must make
 * zero external HTTP calls, so the style request is answered with an empty
 * MapLibre style (the map still reaches "load", with no tiles to fetch) and
 * every other request to the host is aborted.
 */

import type { BrowserContext, Page } from "@playwright/test";
import { BASEMAP_STYLE_URL, BLANK_BASEMAP_STYLE } from "@/config/geo";

const BASEMAP = new URL(BASEMAP_STYLE_URL);

export const BASEMAP_URL_PATTERN = `**://${BASEMAP.host}/**`;

const BASEMAP_STYLE_PATH = BASEMAP.pathname;
const CORS_HEADERS = { "access-control-allow-origin": "*" };

/** Stub the live basemap host on a context or a single page. */
export async function stubBasemap(target: BrowserContext | Page): Promise<void> {
  await target.route(BASEMAP_URL_PATTERN, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === BASEMAP_STYLE_PATH) {
      await route.fulfill({ json: BLANK_BASEMAP_STYLE, headers: CORS_HEADERS });
      return;
    }
    await route.abort();
  });
}
