# Marketing Site

The public noma site (Home, Product, Why noma, Get started) is an Astro app in
`site/`, deployed separately from the app. Read this before changing the site,
its Vercel projects or its domains. Component conventions and the page plan
live in [`site/src/components/site/README.md`](../site/src/components/site/README.md);
the original build plan is archived in
[`docs/archive/plans/2026-09-29-landing-page.md`](./archive/plans/2026-09-29-landing-page.md).

## Layout

```text
site/
├── astro.config.mjs
├── package.json, pnpm-lock.yaml, pnpm-workspace.yaml   own pnpm workspace
├── public/            favicon, brand logos; images/ holds local-only photos
├── scripts/           export-contours.mjs (regenerates the contour SVGs)
└── src/
    ├── pages/         index, product, why, get-started
    ├── components/site/   shell, sections, stages (see its README)
    ├── data/          trace graph engine (core.js) and example records
    ├── content/copy.js    walkthrough form copy
    ├── lib/assets.js  local-only asset paths
    ├── config.js      nav, section anchors, APP_URL / login flag
    └── styles/tokens.css
```

Fonts are read from the app's `src/styles/fonts/` one directory up, so the site
needs the whole repository checked out, not only `site/`.

The Mafinga photo (`site/public/images/mafinga-field-trial.jpg`) is gitignored
because the repo is public and Dark Earth Carbon has not approved publishing it.
A build without the file shows a hatched placeholder; never commit it.

## Page Roles

Each topic has one home page. Before adding or moving a section, check this
table: a section that restates another page's topic reads as doubling, and Home
drifting into Product's detail is the usual way it happens.

| Page | Owns | Dark stage |
| --- | --- | --- |
| Home (`index.astro`) | A short tour: one block per destination, each linking deeper by anchor (`site/src/config.js`). It shows, it doesn't explain. | `TraceStage` |
| Product (`product.astro`) | What the software does: Trace, Bins and stock, Emissions, Evidence and reporting, What's next (`PRODUCT_SECTIONS`). | `EvidenceStage` |
| Why noma (`why.astro`) | Why it is built this way: the five principles (`WHY_PRINCIPLES`), the comparison with spreadsheets and other dMRVs, open source, ownership, Mafinga. | `CompareStage` |
| Get started (`get-started.astro`) | The two actions only: book a walkthrough, or self-host from GitHub. | none |

The light pages with one dark keynote stage each are a settled decision, set out
in `site/src/components/site/README.md` (Plan). Don't reopen it per section.
When a Home block and its target section start to look alike, shorten the Home
block and link; don't add a second visual for the same idea.

## Run It

From the repo root: `pnpm site:dev` (port 3120) and `pnpm site:build`. Both
call the site's own scripts (`pnpm --dir site dev|build`). Install once with
`pnpm install` inside `site/`. In a worktree, run a fresh install there; never
symlink `node_modules` to the main checkout.

`.github/workflows/site.yml` runs on changes to `site/`, `src/styles/fonts/` or
itself: frozen install, `pnpm check:assets` (every root-relative file referenced
from `site/src` exists in `site/public`; the private photo below is the one
exception), `pnpm check` (`astro check`, strict) and `pnpm build`. Run the same
three from `site/` before pushing.

For screenshots, use the opt-in capture spec `tests/visual/site-capture.spec.ts`
(knobs at its top) instead of writing a one-off script. It runs from the repo
root against the running site through `playwright.visual.config.ts`, and
imports from `@playwright/test`, not the app's E2E fixtures.

## Why It Is a Standalone pnpm Package

`site/` has its own `pnpm-workspace.yaml` and lockfile and is not listed in the
root workspace. Adding it to the root workspace pulls the app's Vitest onto
Vite 8. Root Vitest also excludes `site/**`.
Keep the two installs separate.

## Environment Variables

Astro reads `site/.env.local` locally (gitignored by the root `.env*` rule) and
the site project's Vercel env vars when deployed.

| Variable | Effect |
| --- | --- |
| `PUBLIC_APP_URL` | App origin, for example `https://staging.app.noma.maji.studio`. Unset hides the header's Log in link. |
| `PUBLIC_MAPTILER_KEY` | Basemap for the Home hero map (the app's domain-locked MapTiler key; the site domain must be allowed on it). Unset plots the sites on a dotted field. |

## Vercel Projects and Domains

Two Vercel projects build from this one repository:

| Project | Root directory | Skips a build when |
| --- | --- | --- |
| `noma-dmrv` (app) | repo root | nothing outside `site/` changed since the last successful deployment |
| `noma-site` (site) | repo root (`cd site` in its build and install commands) | nothing in `site/`, `src/styles/fonts/` or the root `vercel.json` changed since the last successful deployment |

Both projects read the root `vercel.json`, whose `ignoreCommand` runs
`scripts/vercel-ignore-build.sh` and overrides any Ignored Build Step set in the
dashboard. The script picks the rule by `VERCEL_PROJECT_ID` and builds whenever it
cannot tell: an unknown project, no previous deployment, or a previous commit
outside Vercel's shallow clone (a branch that merged in many staging commits).
Because both projects read it, any key added to the root `vercel.json` (crons,
functions, headers) applies to the site as well as the app. The daily API purge cron
(`/api/cron/purge-api-records`) therefore also fires against the site's production
deployment, which answers 404; Vercel logs the failed invocation and nothing else
happens.

| Environment | App | Site |
| --- | --- | --- |
| Staging | `staging.app.noma.maji.studio` | `staging.noma.maji.studio` |
| Production (planned) | `app.noma.maji.studio` | `noma.maji.studio` |

Domain and project settings changes are made in the Vercel dashboard by the
owner; the repository carries `vercel.json` and the ignore script.

## Code Quoted on the Site

`/why` quotes four calculations verbatim with their line numbers and a worked
example each: `deriveMassDryKg`, `countedRoundTripKm`, `computeFDurable200` and
`computeCo2eStoredTonnes`. The quotes live in
`site/src/components/site/why/math-excerpts.json` (shown by `MathExcerpt.astro`).
`tests/site-math-excerpt.test.ts` fails when a quoted function or its position
changes, or when an example's figure no longer matches what the function returns;
update `lines` and `firstLine` (or the example) in the JSON to match.
