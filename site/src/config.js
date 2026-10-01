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
export const WHY_SECTIONS = [
  { id: "who", label: "Who it’s for" },
  { id: "spreadsheets", label: "noma vs spreadsheets" },
  { id: "open-source", label: "Open source and ownership" },
  { id: "mafinga", label: "Built in Mafinga" },
];
