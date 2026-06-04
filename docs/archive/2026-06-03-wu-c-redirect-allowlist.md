# WU-C — Tighten the document redirect allowlist (config-backed, mirror the sibling)

> **ARCHIVED 2026-06-03 — DONE.** Shipped the same day: shared matcher extracted
> to `src/lib/net/host-allowlist.ts`, `redirect-allowlist.ts` narrowed to
> `.s3.amazonaws.com` / `.storage.googleapis.com` / `.digitaloceanspaces.com` /
> `.isometric.com` (broad families dropped), `ISOMETRIC_STORAGE_REDIRECT_HOSTS`
> env override added, covered by `tests/redirect-allowlist.test.ts` +
> `tests/documents-route.test.ts`. Recorded in `docs/isometric/changes.md`
> (2026-06-03 entry). Kept for the rationale/grounding it captured.
>
> Self-contained execution plan. Picks up the deferred WU-C item from the
> 2026-06-02 audit-remediation pass (see `docs/isometric/changes.md`). Safe to
> execute in a fresh context — all grounding is inline.

## Context

`/api/documents/[id]` 302-redirects the browser to a document row's legacy
`fileUrl` (rows without an internal `storageKey`). The guard at
`src/lib/documents/redirect-allowlist.ts` currently allows whole provider
families:

```ts
const CLOUD_HOST_SUFFIXES = [".isometric.com", ".amazonaws.com",
  ".googleapis.com", ".digitaloceanspaces.com"];
```

`.amazonaws.com` / `.googleapis.com` admit **any** tenant's bucket / Google
property (`attacker-bucket.s3.amazonaws.com`, `maps.googleapis.com`), so the
guard barely constrains the threat its own header names ("a malicious authed
user storing a phishing URL to borrow this origin's domain trust").

**Calibration (do not over-rate):** this is a 302 *browser* redirect (the URL
bar shows the real host) and the `fileUrl` is writable only by an authenticated
user, not a request-attacker — so it is **consistency hardening, not an
exploitable SSRF**. The fix is to stop diverging from the sibling guard, not an
emergency.

## Key insight — the sibling guard already solved this

`src/lib/isometric/utils/signed-upload.ts` guards the *opposite* direction (we
PUT to Isometric-presigned upload URLs) and already does it right:

```ts
// signed-upload.ts
const DEFAULT_UPLOAD_HOST_SUFFIXES = [
  ".s3.amazonaws.com",          // NOT broad .amazonaws.com
  ".isometric.com",
  ".digitaloceanspaces.com",
  ".storage.googleapis.com",    // NOT broad .googleapis.com (comment explains why)
];
const S3_REGIONAL_HOST_PATTERN  = /(^|\.)s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/;
const S3_DUALSTACK_HOST_PATTERN = /(^|\.)s3\.dualstack\.[a-z0-9-]+\.amazonaws\.com$/;
// uploadHostAllowlist() returns DEFAULT_… unless env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST
// is set, in which case that comma-separated, dot-normalized list REPLACES the defaults.
```

WU-C = make `redirect-allowlist.ts` mirror this. That:
- drops the broad `.amazonaws.com` / `.googleapis.com` (closes the finding),
- keeps `.isometric.com` + the **narrow** storage families, so isometric.com /
  presigned-S3 / GCS report URLs keep working **without guessing a bucket name**,
- reconciles the two divergent SSRF guards (a maintainability item flagged in the
  thermo-nuclear review #7).

> Residual after this change: the narrow `.s3.amazonaws.com` still matches any S3
> bucket. That matches the upload guard's posture and is acceptable for a
> browser-visible 302. To tighten to the *exact* Isometric bucket, set the new
> env var (below) to the precise host once known — it then **replaces** the
> default families entirely.

## Decision (already made with the operator)

Hybrid: hardcoded narrow defaults (mirroring `DEFAULT_UPLOAD_HOST_SUFFIXES`) +
same-origin + `STORAGE_ENDPOINT`, with an **optional env override** that replaces
the defaults with an explicit exact-host list. No guessed bucket names in code.

## Steps

### 0. (Optional, recommended) Confirm where GHG-statement report URLs resolve
So the narrow defaults are known-sufficient (and to learn the exact bucket for
the env override). Two cheap checks:
- **Isometric MCP:** `mcp__isometric__how_to` then inspect the certify OpenAPI
  GHG-statement / report objects for the report-URL host, or `isometric_docs_*`.
- **DB:** look for any stored report/file URLs:
  `SELECT file_url FROM documents WHERE file_url IS NOT NULL LIMIT 20;` and the
  `certifier_document_uploads` / `certifier_ghg_statements` rows.
If reports live on `*.isometric.com` or presigned `*.s3.amazonaws.com` /
`*.storage.googleapis.com`, the narrow defaults already cover them.

### 1. Env var — `src/config/env.ts` + `.env.example`
Add next to `ISOMETRIC_UPLOAD_HOST_ALLOWLIST` (same shape):
```ts
ISOMETRIC_STORAGE_REDIRECT_HOSTS: z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional(),
),
```
Document it in `.env.example` (exists): comma-separated explicit hosts that
**replace** the default redirect families; leave empty to use the safe defaults.

### 2. `src/lib/documents/redirect-allowlist.ts` — mirror the sibling
- Replace `CLOUD_HOST_SUFFIXES` with defaults matching
  `DEFAULT_UPLOAD_HOST_SUFFIXES` (`.s3.amazonaws.com`, `.isometric.com`,
  `.digitaloceanspaces.com`, `.storage.googleapis.com`) + the S3 regional /
  dualstack patterns.
- Add an `env.ISOMETRIC_STORAGE_REDIRECT_HOSTS` override that, when set, replaces
  the default families (dot-normalized, comma-split — copy `uploadHostAllowlist()`).
- Keep `exactAllowedHosts()` (same-origin `NEXT_PUBLIC_APP_URL` + `STORAGE_ENDPOINT`).
- Keep the existing protocol + embedded-credential (`user:pass@`) refusals in the
  route — already correct, do not touch.

### 2b. (Stretch — recommended) Extract one shared host-matcher
The host-suffix + S3-pattern + dot-normalization logic now lives in two files.
Extract to e.g. `src/lib/isometric/utils/host-allowlist.ts` (or `src/lib/net/`)
and have both `signed-upload.ts` and `redirect-allowlist.ts` consume it, so the
two SSRF guards can't drift again (review #7). Keep their *host sets* distinct;
share only the matching algorithm.

### 3. Tests — `tests/documents-route.test.ts`
Existing assertions to keep green: `files.isometric.com` → 302; `example.com` →
502; `user:pass@…` → 500. Add:
- `https://maps.googleapis.com/x` → **502** (was 302 under broad `.googleapis.com`).
- A non-storage AWS host, e.g. `https://console.aws.amazon.com/x` or
  `https://ec2.amazonaws.com/x` → **502** (was 302 under broad `.amazonaws.com`).
- A presigned-style storage host, e.g. `https://bucket.s3.eu-west-1.amazonaws.com/r.pdf`
  → **302** (regional S3 pattern still allowed).
- With `ISOMETRIC_STORAGE_REDIRECT_HOSTS` set to an exact host, that host → 302
  and a default-family host → 502 (override replaces defaults). Set the env in the
  test via the existing `.env.test` / `vi` env-mock pattern used elsewhere.

### 4. Docs reconcile
- `docs/open-questions.md`: the redirect note under the robustness pass — mark the
  broad-suffix item resolved; note the residual (any-S3-bucket) + that the env var
  tightens to an exact bucket.
- `docs/isometric/changes.md`: new dated entry (mirror the 2026-06-02 style).
- **Honest authz note — do NOT conflate:** `security.md` requires authz in the
  **data-access** layer. `src/data-access/documents.ts` lets any authenticated
  user fetch any document UUID — accepted **single-tenant** debt (integration-plan
  gate #3 / `security/facility-membership-authz`). This redirect change does not
  touch that; don't imply it does.

## Verification
- `pnpm test tests/documents-route.test.ts` (updated) + `tests/signed-upload.test.ts`.
- `pnpm typecheck && pnpm lint`.
- Manual: a `documents` row with a `fileUrl` on a non-storage cloud host → 502;
  on `files.isometric.com` (or a presigned S3/GCS host) → 302.
- Do **not** push; hand back per the repo's commit convention.

## Out of scope
Data-access IDOR (single-tenant gate #3), the `STORAGE_ENDPOINT` path-style vs
virtual-hosted-bucket nuance (M4 — only matters if reports use virtual-hosted
storage *and* you tighten via env; the narrow `.s3.amazonaws.com` /
`.digitaloceanspaces.com` defaults already cover virtual-hosted hosts).
