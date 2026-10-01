// Site configuration shared by the shell and every page.
// Login stays hidden until the app is public: flip SHOW_LOGIN to render the nav link.
export const LOGIN_URL = "https://app.noma.maji.studio";
export const SHOW_LOGIN = false;
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
  { id: "evidence", label: "Evidence and reporting" },
  { id: "next", label: "What’s next" },
];
// /why is five principles (the hero lists them as the page index); principle 1 compares with spreadsheets.
// Home links to #who (the hero's audiences), #open-source and #mafinga.
export const WHY_PRINCIPLES = [
  { id: "sources", label: "Every figure has a source" },
  { id: "evidence", label: "Evidence stays with the record" },
  { id: "open-source", label: "The math is public" },
  { id: "ownership", label: "Your data stays yours" },
  { id: "mafinga", label: "Built where biochar is made" },
];
