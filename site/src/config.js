// Site configuration shared by the shell and every page.
// The app's address comes from PUBLIC_APP_URL, set per Vercel environment (staging:
// https://staging.app.noma.maji.studio). Without it the header's "Log in" link stays hidden.
export const APP_URL = import.meta.env.PUBLIC_APP_URL || "";
export const LOGIN_URL = APP_URL ? `${APP_URL}/login` : "";
export const SHOW_LOGIN = Boolean(APP_URL);
// Basemap shared by the Home hero map and the Journey map: OpenFreeMap Positron (no key). If the
// style does not load within BASEMAP_STYLE_TIMEOUT_MS (or errors before it parses) the maps fall
// back to BASEMAP_BLANK_STYLE over a dotted field.
export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
export const BASEMAP_BLANK_STYLE = { version: 8, sources: {}, layers: [] };
export const BASEMAP_STYLE_TIMEOUT_MS = 8000;
export const GITHUB_URL = "https://github.com/Maji-Studio/noma-dmrv";

export const BRAND = { name: "noma", by: "by MAJI" };

// `key` is what pages pass to SiteShell as `current`, which sets aria-current on the link.
export const NAV = [
  { key: "home", label: "Home", href: "/" },
  { key: "product", label: "Product", href: "/product" },
  { key: "why", label: "Why noma", href: "/why" },
];
export const NAV_CTA = { key: "get-started", label: "Get started", href: "/get-started" };

// Product chapters (the sticky index) and the section ids inside them. Home links to these; the Product page
// must use the same ids. Each chapter id sits on its ChapterHead; the sections keep their own ids.
export const PRODUCT_SECTIONS = [
  { id: "run", label: "Run the plant" },
  { id: "credits", label: "Get credits issued" },
  { id: "proof", label: "Sell with proof" },
  { id: "scale", label: "Across your sites" },
];
// /why is five principles (the hero lists them as the page index); principle 1 compares with spreadsheets and paper, and other biochar dMRVs.
// Home links to #who (the hero's audiences), #open-source and #mafinga.
export const WHY_PRINCIPLES = [
  { id: "sources", label: "Every figure has a source" },
  { id: "evidence", label: "Evidence stays with the record" },
  { id: "open-source", label: "The math is public" },
  { id: "ownership", label: "Your data stays yours" },
  { id: "mafinga", label: "Built where biochar is made" },
];
