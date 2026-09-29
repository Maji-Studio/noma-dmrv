# noma landing page

**Owner:** Kenji Nguyen · **Status:** approved (three grilling rounds, 2026-09-29), ready to build; logos, DEC figures, screenshots and the inbox address still to come from the owner · **Last reviewed:** 2026-09-29

The decisions below came out of three grilling rounds recorded on the [noma landing page review](https://claude.ai/artifact/9fMhFy8wuMmHqLA64uVfwM). That page also has the research, five rejected alternatives and the approved draft. The draft's source is checked in as [`assets/2026-09-29-landing-page-prototype.html`](./assets/2026-09-29-landing-page-prototype.html). Open it in a browser: the **Draft page** tab is the page to build and the **Visuals** tab has the interactive pieces. Its code is a reference to port, not production code.

## Purpose

One public page at `noma.maji.studio` that tells carbon managers and project developers at biochar producers what noma does, proves it with a trace they can click, and gets them to request a walkthrough.

## Decisions

| Topic | Decision |
| --- | --- |
| Reader | Carbon managers and project developers at biochar producers. Operators and verifiers are served by the same content, not by their own sections. |
| Main action | "Book a walkthrough", which scrolls to a short request form. |
| Second action | "Open the demo", **left out at launch**. It returns once a read-only demo account exists (see Later). |
| Name | noma by MAJI. |
| Headline | "Trace every tonne of biochar, from feedstock to certification." |
| Business model | Self-host free (MIT), or talk to us about hosting. No prices. |
| Registry claim | "Built on Isometric's data model." Never "live", "integrated" or "certified": production submission is blocked today and only the sandbox is tested. Other registries: "More registries later." |
| Future features | Five tiles tagged "Upcoming", below the shipped features. |
| Proof | Logos of Dark Earth Carbon, REPIC, FiBL and Isometric. Mafinga capacity (1,800 t a year) and tonnes traced in noma, both only with DEC's written OK. Tonnes traced is a fixed number, updated by hand. |
| Comparison | Against spreadsheets only. No competitor names. |
| Visuals | Interactive drawings on made-up data, plus three product screenshots: traceability DAG, bin history, removal readiness. |
| Map | Real region (Southern Highlands, Tanzania), made-up points, labelled illustrative. |
| Look | The app's design system: GT Flexa, the same colours, louder type, light rose page background. |
| Language, scope | English only. One long page; docs stay on GitHub. |
| Launch | Soon, with the honest status wording above. |
| Build | Astro site in `site/` inside this repo, deployed as its own Vercel project. |
| Form backend | A server endpoint on the site that emails each request through Resend to an existing MAJI address. |
| Domains | Site on `noma.maji.studio`. The app is not in production yet; give production `app.noma.maji.studio` from day one. |

## Claim boundaries

Checked against the code on 2026-09-29. Copy must stay inside these.

- **Traceability** (shipped): lineage graph, map, dry-mass Sankey and per-application trail, from feedstock delivery to field application. Don't call it an "immutable ledger": the trail is rebuilt from domain records.
- **Bins** (shipped): split bins drawn oldest first, mix bins drawn pro-rata, every movement logged with mass, moisture, time and actor. FIFO applies to biochar and product bins only.
- **Mass** (shipped): wet and dry side by side; dry biochar carried downstream.
- **Energy** (partial): entered by hand per production run (electricity kWh, diesel litres). Never "live" or "metered".
- **Registry** (partial): one action per Removal bundles sources, production batch, datapoints, applications, samples and GHG entry, after a readiness check. Only Isometric exists; there is no multi-registry adapter.
- **Upcoming** (none built): document recognition, live reactor readings, open API and MCP, Telegram, AI checks. Every tile carries the "Upcoming" chip.
- **No uniqueness claims.** An earlier positioning study (see Prior work) found that Cula advertises split and recombined material tracking with origin kept. Don't write "only", "first" or "unlike others".
- Follow [ux-writing.md](../ux-writing.md): no en or em dashes, sentence case headings.

## Page, top to bottom

Copy is final unless marked. The prototype's Draft page tab shows the layout.

1. **Nav.** "noma" with "by MAJI"; links to Trace, Features, Registry, Open source; "Book a walkthrough" button.
2. **Hero.** Headline as above. Lead: "noma records biochar production from feedstock delivery to field application, and builds your registry submission from the same records. Click any square to see what it came from and what it became." Button: Book a walkthrough. Below: the **simple trace** (visual A). Then the logo row ("Built with and supported by": DEC, REPIC, FiBL, Isometric) and the figures line: "1,800 t of biochar a year at the first site in Mafinga, Tanzania. [figure] t traced in noma so far."
3. **Dense trace.** "Real plants are messy. The trace still holds." Lead: "Split bins, mix bins, several deliveries per run. Hover a mix bin to see how far one merge reaches, or a field to walk it back to the sawmills." Visual B, then the three screenshots.
4. **Map.** "Same records, on the map." Lead: "Suppliers, the plant and every field where biochar went into the soil, with haul distances from the record." Visual C.
5. **Features.** "Everything a biochar plant records, linked." Lead: "What's shipped today, and five things we're building next."
   - Featured block "Bins that do the arithmetic" with visual D and: "Split bins keep each batch separate and are drawn oldest first. Mix bins take every layer in proportion. Each draw is logged with mass, moisture, time and who did it."
   - Nine shipped tiles, three columns: Dry and wet mass; Feedstock and formulations; Upstream records; Energy per run; Lab samples; Field boundaries; Evidence on every step; Readiness check; Mass balance. Copy is in `FEATS` in the prototype.
   - Five upcoming tiles in one row (`UPCOMING` in the prototype). AI checks: "Flags readings that don't fit before a verifier sees them." Telegram: "Log deliveries, runs and readings from a Telegram chat."
   - Table "What changes when you leave the spreadsheet", five rows as in the prototype.
6. **Registry.** "Your records, in the registry's shape." Lead: "noma is built on Isometric's data model. It maps production, transport and lab records onto it, checks what's missing, and bundles each removal into one submission. More registries later." Visual E.
7. **Open source.** "Open source. Run it yourself, or let us." Two cards: "Self-host" (free, MIT, Postgres and Next.js, "your verifier can read the math", View on GitHub) and "We run it for you" (setup, hosting, protocol updates, Book a walkthrough).
8. **Walkthrough form.** "Book a walkthrough." Lead: "We'll walk through the trace, the bins and the registry mapping on a plant like yours. Tell us a little about it." Fields: Name, Work email, Company, Plant size (Not producing yet / Under 500 t a year / 500 to 2,000 t a year / Over 2,000 t a year), "Anything we should know (optional)". Button: "Request a walkthrough".
9. **Footer.** "noma by MAJI, Zurich" · "MIT licence. Built with Dark Earth Carbon in Mafinga, Tanzania." · GitHub link.

## Visuals

All five are plain SVG and JavaScript in the prototype; port them as Astro components with a client script each. Keep the data made up and seeded (the prototype uses a fixed-seed PRNG so the layout never changes).

| Visual | Prototype code | Behaviour |
| --- | --- | --- |
| A. Simple trace | `CHAIN_N`, `CHAIN_E`, `drawGraph`, `wire` | 14 records behind one removal, square nodes with stage glyphs. Hover, focus or tap lights up everything upstream and downstream (two BFS walks, never mixed); click pins; Escape clears. Side panel shows the record and counts by stage. Nodes are tabbable; arrow keys follow edges. |
| B. Dense trace | `buildDense`, `layoutDense` | About 180 records over six weeks: suppliers, deliveries, feedstock bin fills, runs, split and mix biochar bins, products, dispatches, fields, credit batches, samples, removals. Layered by stage column with barycenter ordering (four sweeps). Same highlight code as A; nodes not tabbable, so offer a "Trace from" select for keyboard users (in the prototype's Visuals tab). |
| C. Map | `renderMap` | Same records placed on a projected SVG of the Southern Highlands (real towns, roads sketched). Plant internals collapse into one square. Hovering a field highlights the sawmills its biochar came from, and the reverse. No tile service or API key. |
| D. Bin squares | `mountBinSquares`, `binReadout` | One square is 10 kg dry biochar. Split mode: three sub-bins drawn oldest first. Mix mode: one bin, each layer drawn pro-rata by remaining solids, layers kept on their own rows. Controls: mode, dry mass drawn, departure moisture, "Play the draw". Dashed squares are water at departure moisture. Below: before and after as two blocks with an arrow (bin, truck), plus per-layer chips. |
| E. Registry mapping | `MORPH`, `mountMorph` | Seven noma fields mapped row by row onto Isometric fields (real names from `src/lib/isometric/transformers/datapoint.ts` and friends), then bundled into "Removal RM-2026-004". Plays on a button press. |

Rules for all of them: respect `prefers-reduced-motion` (no stagger, no flow dashes), keep hit areas at least 24 px on touch, delegate pointer events on the SVG, and keep each visual inside its own `overflow-x: auto` container so the page never scrolls sideways at 400 px.

## Build

- **Location.** `site/` with its own `package.json`. Add `site` to `pnpm-workspace.yaml` packages. Exclude `site/**` from the root `tsconfig.json`, ESLint and Vitest configs so the app's gates don't pick it up.
- **Framework.** Astro, static output with the Vercel adapter; the page is prerendered and only the form endpoint runs on the server.
- **Design tokens and fonts.** Reuse the app's colour tokens (`src/app/globals.css`) and GT Flexa files (`src/styles/fonts/`). Import them from one source rather than copying, and check that Vercel's "include files outside the root directory" setting allows it. Rules from [design-system.md](../design-system.md) apply. The landing page adds one token: a light rose page background (the prototype uses `#fff2f7`).
- **Form endpoint** (`site/src/pages/api/walkthrough.ts`). Validate with Zod (required: name, email, company, plant size; optional message with a length cap). Add a honeypot field and reject filled ones. Send one email through Resend: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (a sender on a Resend-verified domain, see [mail-setup.md](../mail-setup.md)) and `WALKTHROUGH_TO` (the MAJI inbox, supplied by the owner). Reply-to is the visitor's email. Never log names, emails or message text; log a request id and the outcome only. The page shows a plain success or error message; nothing else is stored.
- **Deploy.** A second Vercel project with root directory `site/`, domain `noma.maji.studio`. Env vars live in the site's own Vercel project and 1Password item, separate from the app's ([security.md](../security.md)).
- **App domain (separate task).** When production is first deployed, give it `app.noma.maji.studio` so `NEXT_PUBLIC_APP_URL`, Better Auth origins and email links never need to move. Staging stays on `staging.noma.maji.studio`.

## Inputs from the owner

These don't block building. Leave clearly marked placeholders until they arrive.

- The MAJI inbox address for `WALKTHROUGH_TO`.
- Logo files for DEC, REPIC, FiBL and Isometric.
- DEC's written OK for the capacity figure and the current tonnes-traced figure.
- The three screenshots, or approval to capture them from staging on the Mafinga seed data (`pnpm db:seed`).

## Suggested slices

1. **Scaffold.** `site/` with Astro, workspace and config exclusions, tokens, fonts, layout, all static sections and copy, placeholders for logos, figures and screenshots. Everything below builds on this.
2. **Traces.** Visuals A, B and C (shared graph code).
3. **Bins and registry.** Visuals D and E.
4. **Form.** Endpoint, validation, Resend, success and error states.
5. **Deploy.** Vercel project, env vars, domain. Needs the owner for Vercel and DNS access.

Slices 2, 3 and 4 can run in parallel once 1 is merged.

## Acceptance

- `pnpm lint`, `pnpm typecheck` and the app's tests are unaffected by `site/`; the site has its own build and type check.
- At 400 px wide there is no horizontal page scroll, and every visual works by tap.
- The traces can be used by keyboard; reduced motion turns off all animation.
- No en or em dashes in site copy; every upcoming feature carries its chip; no "live", "integrated", "only" or "first" claims.
- A form submission in a Vercel preview deployment arrives in the inbox; logs contain no personal data.

## Later

- **Demo.** One-click entry to a read-only demo account seeded like Mafinga. Needs a read-only role in the app first (today: Owner, Admin, Member). Then add "Open the demo" next to "Book a walkthrough" in the hero and form.
- **Upcoming features.** Each tile loses its chip only when the feature ships.

## Prior work

Branch `codex/public-website` (Codex worktree, last commit 2026-09-28, no PR) built a different website: several marketing routes inside the Next.js app, 3D landscape illustrations and `docs/website.md`. This plan replaces that approach (separate static site, one page). Don't merge or port its structure. Things worth reusing after checking: `public/landing/maji-logo.svg`, `public/landing/mafinga-field-trial.jpg` (confirm the photo rights with DEC), and the positioning research note `docs/archive/research/2026-09-23-dmrv-website-positioning.md` on that branch, which is the source of the Cula finding above. Whether to delete the branch is the owner's call.
