// PROTOTYPE ONLY (branch prototype/landing-width-variants, never merge). The layout variants the switcher cycles through.
// Key 0 is today's edge-to-edge page on "/"; each other variant is its own static route under /v/<key>/.
export const VARIANTS = [
  { key: "0", name: "Current, edge to edge", href: "/" },
  // Round 2 shortlist (Kenji 2026-09-30): Apple and Vercel, refined, plus two hybrids.
  { key: "6", name: "Apple style", href: "/v/6/" },
  { key: "8", name: "Vercel style", href: "/v/8/" },
  { key: "11", name: "Hybrid: Vercel frame, Apple rhythm", href: "/v/11/" },
  { key: "12", name: "Hybrid: Apple hero, Vercel grid", href: "/v/12/" },
  // Round 1, kept for reference.
  { key: "1", name: "Boring", href: "/v/1/" },
  { key: "2", name: "Obvious", href: "/v/2/" },
  { key: "3", name: "Super user friendly", href: "/v/3/" },
  { key: "4", name: "Accessible", href: "/v/4/" },
  { key: "5", name: "Creative", href: "/v/5/" },
  { key: "7", name: "Stripe style", href: "/v/7/" },
  { key: "9", name: "Linear style", href: "/v/9/" },
  { key: "10", name: "Notion style", href: "/v/10/" },
];
