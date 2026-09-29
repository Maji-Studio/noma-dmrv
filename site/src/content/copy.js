// All landing page copy, approved in docs/plans/2026-09-29-landing-page.md.
// Claim rules: never "live", "integrated", "certified", "only", "first"; no en or em dashes;
// sentence case headings; every upcoming feature carries the "Upcoming" chip.
export const copy = {
  brand: { name: "noma", by: "by MAJI" },
  nav: [
    { label: "Trace", href: "#trace" },
    { label: "Features", href: "#features" },
    { label: "Registry", href: "#registry" },
    { label: "Open source", href: "#open-source" },
  ],
  // Chrome strings added in slice 2 (header, menu, skip link, captions, placeholders).
  chrome: {
    skip: "Skip to main content",
    menuOpen: "Menu",
    menuClose: "Close menu",
    navLabel: "Main",
    githubLabel: "GitHub",
    logoPlaceholder: "Logo to come",
    figurePlaceholder: "Placeholder until the figure is confirmed",
    screenshotPlaceholder: "Screenshot placeholder",
    backToTop: "Back to top",
    tableCaption: "Spreadsheet compared with noma",
  },
  // Strings the visuals (visuals/*.js) render.
  visuals: {
    scrollHint: "Scroll sideways",
    traceFrom: "Trace from",
    tracePlaceholder: "Choose a record",
  },
  captions: {
    chain: "Illustrative: made-up records, real record types.",
    dense: "Illustrative: about 180 made-up records over six weeks.",
    map: "Illustrative: Southern Highlands, Tanzania. Real towns, made-up suppliers and fields.",
    bins: "Illustrative: made-up bin, made-up masses.",
    morph: "Illustrative: real field names, made-up values.",
  },
  cta: { primary: "Book a walkthrough", primaryHref: "#walkthrough", github: "View on GitHub", githubHref: "https://github.com/Maji-Studio/noma-dmrv" },
  hero: {
    title: "Trace every tonne of biochar, from feedstock to certification.",
    lead: "noma records biochar production from feedstock delivery to field application, and builds your registry submission from the same records. Click any square to see what it came from and what it became.",
  },
  proof: {
    label: "Built with and supported by",
    logos: ["Dark Earth Carbon", "REPIC", "FiBL", "Isometric"],
    // Both figures wait on DEC's written OK (plan: Inputs from the owner). `pending: true` renders the placeholder
    // treatment; drop it from a figure once approved. Never inferred from the string.
    figures: [
      { value: "1,800 t", pending: true, text: "of biochar a year at the first site in Mafinga, Tanzania" },
      { value: "[figure] t", pending: true, text: "traced in noma so far" },
    ],
  },
  dense: {
    title: "Real plants are messy. The trace still holds.",
    lead: "Split bins, mix bins, several deliveries per run. Hover a mix bin to see how far one merge reaches, or a field to walk it back to the sawmills.",
    // First is the lead screenshot. Set `src` (1440x900 capture at 2x, under site/public) to swap in the real image.
    screenshots: [
      { caption: "Traceability, DAG view", alt: "The noma traceability graph for one credit batch: feedstock deliveries, production runs, biochar products and a delivery out, ending in three field applications.", src: "/screenshots/dag.webp", width: 2880, height: 1800 },
      { caption: "Bin history", alt: "The stock history of a product bin in noma: two intakes and one delivery draw, each with wet mass, moisture and dry biochar before and after.", src: "/screenshots/bin-history.webp", width: 1400, height: 1050 },
      { caption: "Removal readiness", alt: "The noma removal readiness check: 0.4 t of dry biochar traced back to three production runs and three applications, five checks passed and one issue left to fix.", src: "/screenshots/removal-readiness.webp", width: 1750, height: 1324 },
    ],
  },
  map: {
    title: "Same records, on the map.",
    lead: "Suppliers, the plant and every field where biochar went into the soil, with haul distances from the record.",
  },
  features: {
    title: "Everything a biochar plant records, linked.",
    lead: "What's shipped today, and five things we're building next.",
    bins: {
      title: "Bins that do the arithmetic",
      text: "Split bins keep each batch separate and are drawn oldest first. Mix bins take every layer in proportion. Each draw is logged with mass, moisture, time and who did it.",
      hint: "Press play. One square is 10 kg of dry biochar; the dashed squares are the water that rides along at departure moisture.",
    },
    // [glyph, domain, title, text]; glyph keys come from STAGES / EXTRA_GLYPHS in visuals/core.js
    shipped: [
      ["bbin", "prod", "Dry and wet mass", "Moisture at every step. Dry biochar is carried from bin to field, so the credit mass is never re-estimated."],
      ["prod", "dist", "Feedstock and formulations", "Your feedstock types, mapped to the registry catalogue. Blends with compost, manure or lime."],
      ["fd", "prod", "Upstream records", "Deliveries by supplier with mass, moisture, GPS and haul distance."],
      ["run", "prod", "Energy per run", "Electricity and diesel logged with each production run, mapped to the registry's energy components."],
      ["smp", "ver", "Lab samples", "Organic carbon, H/C org and R0 per credit batch, three replicates each."],
      ["app", "dist", "Field boundaries", "Every application carries its field boundary and evidence."],
      ["cb", "ver", "Evidence on every step", "Weighbridge tickets, bills of lading, lab reports and photos, attached where they belong."],
      ["rem", "ver", "Readiness check", "See what a removal is missing before you submit it."],
      ["bbin", "prod", "Mass balance", "Dry kilograms in, losses out, per credit batch."],
    ],
    shippedHeading: "Shipped today",
    upcomingHeading: "Building next",
    upcomingLabel: "Upcoming",
    upcoming: [
      ["doc", "infra", "Document recognition", "Read weighbridge tickets and lab reports straight into records."],
      ["pulse", "prod", "Live reactor readings", "Temperature and energy from the reactor, without typing them in."],
      ["plug", "infra", "Open API and MCP", "Connect other tools, and LLMs, to your plant's records."],
      ["chat", "dist", "Telegram", "Log deliveries, runs and readings from a Telegram chat."],
      ["spark", "ver", "AI checks", "Flags readings that don't fit before a verifier sees them."],
    ],
  },
  compare: {
    title: "What changes when you leave the spreadsheet",
    columns: ["Spreadsheet", "noma"],
    rows: [
      ["Where a field's biochar came from", "Cross-reference tabs by hand", "Click the field"],
      ["Dry mass after a moisture change", "Recalculate every sheet it touches", "Calculated as you type"],
      ["Oldest-first draws across sub-bins", "Tracked in someone's head", "Planned and logged with each draw"],
      ["Evidence for each step", "Folders and email attachments", "Attached to the record it proves"],
      ["Registry submission", "Rebuilt for every removal", "Bundled from the same records"],
    ],
  },
  registry: {
    title: "Your records, in the registry's shape.",
    lead: "noma is built on Isometric's data model. It maps production, transport and lab records onto it, checks what's missing, and bundles each removal into one submission. More registries later.",
  },
  openSource: {
    title: "Open source. Run it yourself, or let us.",
    cards: [
      { chip: "Free", title: "Self-host", text: "MIT licence. Postgres and Next.js. Every calculation is in the repo, so your verifier can read the math.", action: "View on GitHub", href: "https://github.com/Maji-Studio/noma-dmrv" },
      { chip: "Talk to us", title: "We run it for you", text: "Setup, hosting, and updates when protocols change. Same code, your data stays yours.", action: "Book a walkthrough", href: "#walkthrough" },
    ],
  },
  walkthrough: {
    title: "Book a walkthrough.",
    lead: "We'll walk through the trace, the bins and the registry mapping on a plant like yours. Tell us a little about it.",
    fields: { name: "Name", email: "Work email", company: "Company", size: "Plant size", message: "Anything we should know (optional)" },
    sizes: ["Not producing yet", "Under 500 t a year", "500 to 2,000 t a year", "Over 2,000 t a year"],
    submit: "Request a walkthrough",
    sent: "Thanks. We'll be in touch.",
    sending: "Sending your request.",
    prototypeNote: "(Prototype: nothing was sent.)",
    // No inbox address yet: the address is added when the owner supplies it (plan: Inputs from the owner).
    error: "That didn't go through. Try again, or email us.",
    errors: {
      name: "Enter your name.",
      email: "Enter your work email.",
      emailInvalid: "That email doesn't look right. Check it and try again.",
      company: "Enter your company.",
    },
  },
  footer: { left: "noma by MAJI, Zurich", right: "MIT licence. Built with Dark Earth Carbon in Mafinga, Tanzania." },
};
