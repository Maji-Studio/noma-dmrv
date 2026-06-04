# E2E: run document uploads against real Spaces in CI

> **ARCHIVED 2026-06-03 — not started, deprioritized.** No code from this plan
> landed: `.github/workflows/e2e.yml` still defaults to `local-fs` (no
> `STORAGE_PROVIDER=s3-compatible`), and neither
> `tests/e2e/fixtures/storage-fixtures.ts` nor `tests/e2e/storage-upload.spec.ts`
> exist. The plan is self-contained and can be executed as-written if/when CI
> integration coverage for object storage is prioritized.

## Context

PR #111 (`feature/s3-storage`) introduced object storage with a fail-closed
guard in `src/config/env.ts:127-134` that rejects `STORAGE_PROVIDER=local-fs`
when `NODE_ENV=production`. Playwright CI runs `pnpm build && pnpm start`
(`playwright.config.ts:55`), which sets `NODE_ENV=production`. Because the
e2e workflow (`.github/workflows/e2e.yml`) doesn't set `STORAGE_PROVIDER`, it
defaults to `local-fs`, the env schema crashes at server boot, and the entire
suite fails before any test runs:

```text
[WebServer] Error [ZodError]: STORAGE_PROVIDER must be 's3-compatible' in
production. 'local-fs' is rejected as a security safeguard.
```

We want CI to exercise the same `s3-compatible` path that staging/prod use
(DO Spaces) — that's the whole point of an integration test for the storage
feature. A dedicated CI Spaces bucket keeps blast radius zero, per-test
cleanup keeps the bucket tidy, and a lifecycle rule mops up orphans from
crashed runs.

## Scope

1. Unblock e2e by wiring `s3-compatible` env vars (incl. secrets) into the
   workflow.
2. Provision a dedicated CI Spaces bucket + scoped access key + 7-day
   lifecycle rule on `ci/*`.
3. Add one Playwright spec covering the full upload → confirm → download →
   delete cycle, with a fixture that auto-cleans uploaded objects.

Out of scope: backfilling upload coverage into existing per-entity specs
(separate follow-up issue).

## 1. Provision Spaces (one-time, manual)

- [ ] Create Spaces bucket: `noma-dmrv-ci` (same region as staging).
- [ ] Create a Spaces access key scoped to that bucket only.
- [ ] Add bucket lifecycle rule: expire objects under prefix `ci/` after
      7 days.
- [ ] Store in GitHub repo secrets:
  - `CI_STORAGE_ACCESS_KEY_ID`
  - `CI_STORAGE_SECRET_ACCESS_KEY`
  - `CI_STORAGE_SIGNING_SECRET` (32+ char random, `openssl rand -hex 32`)
- [ ] Store in GitHub repo vars (non-secret):
  - `CI_STORAGE_BUCKET=noma-dmrv-ci`
  - `CI_STORAGE_REGION` (e.g. `fra1`)
  - `CI_STORAGE_ENDPOINT` (e.g. `https://fra1.digitaloceanspaces.com`)

## 2. Workflow changes — `.github/workflows/e2e.yml`

Two places to update; both must match.

**Job-level `env:` block** (currently lines 27–31):

```yaml
env:
  DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/noma_dmrv_e2e
  NEXT_PUBLIC_APP_URL: http://127.0.0.1:3100
  ALLOW_SELF_SIGNUP: "false"
  DISABLE_RATE_LIMIT: "true"
  STORAGE_PROVIDER: s3-compatible
  STORAGE_BUCKET: ${{ vars.CI_STORAGE_BUCKET }}
  STORAGE_REGION: ${{ vars.CI_STORAGE_REGION }}
  STORAGE_ENDPOINT: ${{ vars.CI_STORAGE_ENDPOINT }}
  STORAGE_ACCESS_KEY_ID: ${{ secrets.CI_STORAGE_ACCESS_KEY_ID }}
  STORAGE_SECRET_ACCESS_KEY: ${{ secrets.CI_STORAGE_SECRET_ACCESS_KEY }}
  STORAGE_SIGNING_SECRET: ${{ secrets.CI_STORAGE_SIGNING_SECRET }}
```

**`.env.local` heredoc** (currently lines 58–65) — extend it so CLI scripts
(`drizzle-kit push`, etc.) see the same values:

```yaml
- name: Write local env file for CLI scripts
  run: |
    cat <<EOF > .env.local
    DATABASE_URL=${DATABASE_URL}
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
    BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
    ALLOW_SELF_SIGNUP=${ALLOW_SELF_SIGNUP}
    DISABLE_RATE_LIMIT=${DISABLE_RATE_LIMIT}
    STORAGE_PROVIDER=${STORAGE_PROVIDER}
    STORAGE_BUCKET=${STORAGE_BUCKET}
    STORAGE_REGION=${STORAGE_REGION}
    STORAGE_ENDPOINT=${STORAGE_ENDPOINT}
    STORAGE_ACCESS_KEY_ID=${STORAGE_ACCESS_KEY_ID}
    STORAGE_SECRET_ACCESS_KEY=${STORAGE_SECRET_ACCESS_KEY}
    STORAGE_SIGNING_SECRET=${STORAGE_SIGNING_SECRET}
    EOF
```

**Fork PR caveat:** GitHub doesn't expose secrets to PRs from forks. If
fork PRs need to be supported, gate the storage env on
`github.event.pull_request.head.repo.full_name == github.repository` and
skip the upload spec for forks. For an internal-only repo, ignore.

## 3. Per-test storage key prefix

In `tests/e2e/fixtures/storage-fixtures.ts` (new file), expose a helper
`ciStoragePrefix()` that returns `ci/${GITHUB_RUN_ID ?? 'local'}/${testId}/`.
The upload spec uses this when building `buildStorageKey()` calls (see
`src/lib/storage/keys.ts:20`) so concurrent runs and concurrent tests never
collide, and so the lifecycle rule on `ci/*` covers everything.

## 4. Tracked-uploads fixture

New file: `tests/e2e/fixtures/storage-fixtures.ts`

Test-scoped fixture (`test.extend` pattern from
`tests/e2e/fixtures/auth-fixtures.ts:481`) that:

- Exposes a `trackUpload(key: string)` function tests call after uploading.
- In teardown (`use()` callback after `await use(...)`), iterates the
  collected keys and deletes them via the storage provider used directly
  from Node (`getStorageProvider()` from `src/lib/storage/index.ts`).
- Wraps each `deleteObject` in try/catch so a 404 (already deleted by the
  test's own `deleteDocument` call) doesn't mask test failures. Log warnings.

Export via the fixtures barrel `tests/e2e/fixtures/index.ts` and merge into
the default `test` export alongside `authFixtures`.

## 5. Upload spec — `tests/e2e/storage-upload.spec.ts` (new)

Single happy-path integration test that exercises every method of
`StorageProvider` (`src/lib/storage/types.ts:28-35`):

1. Authenticate as admin (existing `adminPage` fixture).
2. Call `requestUpload()` server action via the UI's document upload
   component on a seeded entity (e.g., a production sample). Capture the
   returned storage key and `trackUpload(key)`.
3. PUT the test fixture file (a tiny 1KB blob — generate inline, don't
   commit binaries) to the presigned URL using `page.request.fetch()` so
   the request goes through Playwright's network stack.
4. Call `confirmUpload()` — assert it returns success and the DB row
   transitions to `uploadStatus: 'uploaded'`. This exercises
   `headObject()` against real Spaces (`src/fn/documents.ts:108`).
5. Hit `GET /api/documents/[id]` and assert a 302 to a signed Spaces URL.
   Optionally follow the redirect and assert the body matches the upload.
6. Call `deleteDocument()` via UI; the fixture teardown's `deleteObject`
   will be a no-op (404) — that's expected and swallowed.

Assertions are explicit at every step rather than chained through UI
navigation, so a failure points at the specific provider method.

## 6. Verification

- [ ] Push the branch; observe the E2E workflow run.
- [ ] Server starts (no ZodError on STORAGE_PROVIDER).
- [ ] `storage-upload.spec.ts` passes.
- [ ] Existing suite still passes (no regressions from env changes).
- [ ] After the run, check the Spaces bucket: `ci/${run_id}/` prefix is
      empty (per-test cleanup worked) OR contains only objects from the
      failing run. Lifecycle rule will sweep any leftovers within 7 days.
- [ ] Re-run with a forced test failure mid-upload — confirm the fixture
      still deletes the uploaded object on teardown.

## Files touched

- `.github/workflows/e2e.yml` — env block + heredoc
- `tests/e2e/fixtures/storage-fixtures.ts` — new, tracked-uploads fixture
- `tests/e2e/fixtures/index.ts` — re-export
- `tests/e2e/storage-upload.spec.ts` — new spec

## Files referenced (read-only)

- `src/config/env.ts:62-134` — env schema + production safeguard
- `src/lib/storage/types.ts:28-35` — `StorageProvider` interface
- `src/lib/storage/index.ts` — `getStorageProvider()` factory
- `src/lib/storage/s3-compatible.ts` — provider used in CI
- `src/lib/storage/keys.ts:20-39` — `buildStorageKey()`
- `src/fn/documents.ts:41,108,177` — `requestUpload` / `confirmUpload` /
  `deleteDocument` server actions
- `src/app/api/documents/[id]/route.ts:15` — download redirect handler
- `tests/e2e/fixtures/auth-fixtures.ts:481-543` — fixture pattern to mirror
- `playwright.config.ts:55` — CI webServer command
