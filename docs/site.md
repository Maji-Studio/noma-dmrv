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

## Run It

From the repo root: `pnpm site:dev` (port 3120) and `pnpm site:build`. Both
call the site's own scripts (`pnpm --dir site dev|build`). Install once with
`pnpm install` inside `site/`. In a worktree, run a fresh install there; never
symlink `node_modules` to the main checkout.

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
| `noma-dmrv` (app) | repo root | nothing outside `site/` changed since the last successful deployment (`ignoreCommand` in the root `vercel.json`) |
| `noma-site` (site) | `site` | the branch has no `site/` folder (Ignored Build Step `test ! -d site`, run from the repo root, set in the project settings) |

| Environment | App | Site |
| --- | --- | --- |
| Staging | `staging.app.noma.maji.studio` | `staging.noma.maji.studio` |
| Production (planned) | `app.noma.maji.studio` | `noma.maji.studio` |

Domain and project settings changes are made in the Vercel dashboard by the
owner; the repository only carries the app's `vercel.json`.

## Code Quoted on the Site

`/why` quotes four calculations verbatim with their line numbers and a worked
example each: `deriveMassDryKg`, `countedRoundTripKm`, `computeFDurable200` and
`computeCo2eStoredTonnes`. The quotes live in
`site/src/components/site/why/math-excerpts.json` (shown by `MathExcerpt.astro`).
`tests/site-math-excerpt.test.ts` fails when a quoted function or its position
changes, or when an example's figure no longer matches what the function returns;
update `lines` and `firstLine` (or the example) in the JSON to match.
