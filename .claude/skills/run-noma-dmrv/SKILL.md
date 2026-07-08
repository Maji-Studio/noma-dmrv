---
name: run-noma-dmrv
description: Build, run, and drive the noma-dmrv app. Use when asked to start the dev server, run the app, take a screenshot of a page, click through a flow, or verify a UI change in the real running app (not just tests).
---

noma-dmrv is a Next.js 16 web app (biochar carbon-credit MRV) on port 3100 with a
Docker Postgres. Drive it via `.claude/skills/run-noma-dmrv/driver.mjs` — a
Playwright (headless Chromium) one-shot CLI that signs in as the local admin over
the Better Auth HTTP API and then navigates / clicks / fills / screenshots. All
paths are relative to the repo root; run everything from there.

## Prerequisites

Already present on this machine — verify, don't install:

- Node + pnpm (`pnpm --version` → 11.x)
- Docker Desktop running (the DB is the `noma-dmrv-postgres` container, host port **5433**)
- `.env.local` present (holds `ADMIN_EMAIL` / `ADMIN_PASSWORD` the driver signs in with).
  Missing? → `pnpm env:local` (needs 1Password desktop approval — ask the user to run it via `! pnpm env:local`).
- Playwright Chromium (repo devDependency; browsers already installed under `~/Library/Caches/ms-playwright`)

## Run the server

Check first — a dev server is usually already running:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/login   # 200 → skip boot
```

If not running, boot in the **background** (never foreground — it blocks forever):

```bash
pnpm dev   # run_in_background; = docker compose up -d + wait-for-db + next dev -p 3100
```

Ready in a few seconds when the postgres container is already up (log line: `✓ Ready in …ms`).
First compile of a route takes 3–10 s on first visit; the driver's `networkidle` wait absorbs this.

## Drive it (agent path)

```bash
node .claude/skills/run-noma-dmrv/driver.mjs check
# → OK: server up at http://localhost:3100, admin sign-in OK (2 cookie(s))
```

One-shot invocations: first arg is the app path, remaining args are actions run in order.

```bash
node .claude/skills/run-noma-dmrv/driver.mjs /dashboard shot=dashboard.png
node .claude/skills/run-noma-dmrv/driver.mjs /facilities shot=facilities.png \
  'click=button:has-text("Facility")' 'wait=[role="dialog"]' \
  'fill=input[name="name"]::Driver Smoke Test' shot=facility-sheet.png
```

| action | what it does |
|---|---|
| `check` (as first arg) | verify server + admin sign-in, exit |
| `shot=<file.png>` | full-page screenshot → `$TMPDIR/noma-shots/<file>` (path printed; Read it to look) |
| `click=<selector>` | Playwright selector — quote args containing `"` or spaces |
| `fill=<sel>::<value>` | fill an input (`::` separates selector from value) |
| `press=<key>` | keyboard key (`Escape`, `Enter`, …) |
| `wait=<ms\|selector>` | sleep, or wait for selector to appear |
| `goto=<path>` | navigate to another app path mid-sequence |
| `text` | print visible body text (truncated 4000 chars) |
| `html=<selector>` | print outerHTML of first match |
| `--no-auth` (before path) | skip sign-in — lands on `/login` |

Useful routes: `/dashboard`, `/facilities`, `/production-runs`, `/credit-batches`,
`/chain-of-custody`, `/certification`. Deep-link a create sheet with `?create=true`.

## Run (human path)

`pnpm dev` in a terminal → http://localhost:3100 → Ctrl-C to stop. Login form uses
the same admin credentials from `.env.local`.

## Test

```bash
pnpm test:e2e tests/e2e/facilities.spec.ts   # one spec, ~13s — verified: 5 passed
```

Full suite: `pnpm test:e2e` (Playwright reuses the running dev server; hermetic specs only).

Run `pnpm db:reset` first if you hit duplicate-key errors (DESTRUCTIVE — drops all data).
`@live` Isometric-sandbox specs are excluded by default. Unit tests: `pnpm test` (vitest).

## Gotchas

- **Pages are facility-scoped.** The app appends `?facility=<id>` automatically and picks a
  default facility; on an empty DB, list pages show an EmptyState ("select a facility") instead
  of data. Seed via `pnpm db:reset` + the e2e seed if you need entities.
- **Sign-in is rate-limited** (10/15 min) unless `DISABLE_RATE_LIMIT=true` is in `.env.local`
  (it is, on this machine). Each driver invocation performs one sign-in — hammering the driver
  in a tight loop without that flag will start returning 429s.
- **Postgres is on host port 5433, not 5432** (`noma-dmrv-postgres` container). `DATABASE_URL`
  in `.env.local` already points there.
- **The Better Auth API requires an `Origin` header** on sign-in (trustedOrigins check) — the
  driver sends it; hand-rolled `curl` sign-ins without it fail.
- **Restarting the dev server fixes ghost styling** — a long-running `next dev` misses Tailwind
  utilities introduced in new files (class applies but computes to 0). Restart before
  screenshot-judging new UI.

## Troubleshooting

- **`FAIL: no dev server at http://localhost:3100`** — boot it: `pnpm dev` in background,
  poll `curl http://localhost:3100/login` until 200.
- **`sign-in failed: 401 …`** — `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env.local` don't match the
  DB. `pnpm db:ensure-admin` re-syncs the admin user from env.
- **`zsh: == not found`** when chaining shell commands — zsh eats bare `===`; unrelated to the
  driver, quote your echo strings.
- **Click times out on a `button:has-text(…)` selector** — the driver clicks the *first* match;
  scope tighter (e.g. `'click=main >> button:has-text("New Facility")'`) if a sidebar link
  matches first.
