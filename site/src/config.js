// Site configuration shared by the shell and every page.
// The app's address comes from PUBLIC_APP_URL, set per Vercel environment (staging:
// https://staging.app.noma.maji.studio). Without it the header's "Log in" link stays hidden.
export const APP_URL = import.meta.env.PUBLIC_APP_URL || "";
export const LOGIN_URL = APP_URL ? `${APP_URL}/login` : "";
export const SHOW_LOGIN = Boolean(APP_URL);
export const GITHUB_URL = "https://github.com/Maji-Studio/noma-dmrv";

export const BRAND = { name: "noma", by: "by MAJI" };

// `key` is what pages pass to SiteShell as `current`, which sets aria-current on the link.
export const NAV = [
  { key: "home", label: "Home", href: "/" },
  { key: "product", label: "Product", href: "/product" },
  { key: "why", label: "Why noma", href: "/why" },
];
export const NAV_CTA = { key: "get-started", label: "Get started", href: "/get-started" };

// Section anchors. Home links to these; the Product and Why pages must use the same ids.
export const PRODUCT_SECTIONS = [
  { id: "trace", label: "Trace" },
  { id: "bins", label: "Bins and stock" },
  { id: "emissions", label: "Emissions" },
  { id: "evidence", label: "Evidence and reporting" },
  { id: "next", label: "What’s next" },
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
