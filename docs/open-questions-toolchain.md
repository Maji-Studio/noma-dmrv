# Toolchain Open Questions

This companion holds tooling and dependency upgrade decisions split out of
[open-questions.md](./open-questions.md). Read it before changing the project's
compiler, ORM, build, lint, or dependency-management toolchain; the parent
document's schema, invariants, and resolution rules apply here.

## Tooling & toolchain upgrades

Each open decision below links to its authoritative source. The Turbopack
default bundler, `reactCompiler: true`, `src/proxy.ts`, and the
generate-and-migrate CI workflow already match the current project toolchain
and need no follow-up.

### Turbopack production filesystem cache (`tooling/turbopack-build-fs-cache`)

- Current decision: `next.config.ts:nextConfig` gates
  `experimental.turbopackFileSystemCacheForBuild` on
  `NOMA_TURBOPACK_BUILD_CACHE`. The pull-request build paths in
  `.github/workflows/ci.yml:jobs.build` and
  `.github/workflows/e2e.yml:jobs.playwright` persist only
  `.next/cache/turbopack`; reuse is intra-PR, and base-branch and deployed
  builds keep the stable default. The feature remains experimental for
  production builds in the
  [official Next.js documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache).
- **Resolve via:** keep comparing cold and warm GitHub-hosted timings and cache
  transfer/storage cost. Re-evaluate the flag when Next marks production
  filesystem caching stable, renames/removes it, or measurements show that
  transfer and eviction cost outweigh compilation savings (S).

### TypeScript 7 for CI typecheck (`tooling/ts7`)

- Still open: `package.json` pins TypeScript `^5.9.3`; TypeScript 7 is stable,
  but its compiler API transition still affects tools such as typescript-eslint.
- **Resolve via:** install the stable TypeScript 7 package in a dedicated,
  non-blocking parity job and run `pnpm exec tsc --noEmit` against the large
  Drizzle schema and Zod-heavy types. Migrate the blocking typecheck after the
  current lint and toolchain peers are compatible. See the
  [official TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  for installation and compatibility guidance (S).

### Drizzle ORM/Kit v1.0 upgrade (`db/drizzle-v1`)

- Still open: the project uses `drizzle-orm` 0.45 and `drizzle-kit` 0.31 while
  Drizzle v1 remains on its release-candidate line. The v1 changes include a
  full Drizzle Kit rewrite, Relational Queries v2, and a migration-folder
  redesign that removes `journal.json`, reduces potential Git conflicts around
  that file, and simplifies conflicted-migration handling. See the
  [v1 beta.2 release notes](https://orm.drizzle.team/docs/latest-releases/drizzle-orm-v1beta2)
  and the [v1 upgrade guide](https://orm.drizzle.team/docs/upgrade-v1).
- **Resolve via:** verify the current status in the
  [official releases](https://github.com/drizzle-team/drizzle-orm/releases), and
  do not adopt a prerelease. Once v1 is stable, use a dedicated upgrade branch;
  the no-production-data reseed-over-migrate stance makes the migration-folder
  restructure cheap if done before launch (M).

### Cache Components pilot (`app/cache-components`)

- Next 16 caching is fully opt-in via `cacheComponents: true` (`'use cache'` +
  PPR model; `cacheLife`/`cacheTag` stable, old PPR flags removed). For an
  auth-gated, org-scoped app there's no urgency, and no verified real-world
  adoption evidence for auth-heavy apps yet. See
  [`docs/modern-patterns.md`](./modern-patterns.md).
- **Resolve via:** a selective pilot on read-heavy views (dashboard,
  chain-of-custody roll-ups) when perf data justifies it; not codebase-wide (M).

### maplibre-gl v6 upgrade (`maps/maplibre-v6`, opened 2026-10-02)

- Still open: `package.json` pins `maplibre-gl` ^5.24.0
  (PR #870) because v6 derives its web-worker URL from `import.meta.url`, which
  Turbopack rewrites to a `file://` URL, so the worker never starts and every
  basemap renders blank (PR #752). `.github/dependabot.yml` ignores
  `maplibre-gl` semver-major updates for this reason.
- Accepted risk: GHSA-jrc7-96c5-q579 (attribution sanitizer XSS) is fixed only
  in 6.4.1+. It needs untrusted attribution strings; ours are
  `SAT_TILE_ATTRIBUTION` plus the OpenFreeMap and OpenStreetMap style attribution (see
  `src/components/applications/geojson-preview-map.tsx`). The four Dependabot
  alerts were dismissed as tolerable risk on that basis. Revisit if any map
  ever takes an attribution from user or third-party input.
- **Resolve via:** a v6 branch that calls `maplibregl.setWorkerUrl()` with a
  correctly served worker file, kept green by the E2E map smoke test from PR #907, which
  fails on the broken worker.
  Then drop the Dependabot ignore (S).

### Form-audit capture generator lost (`tooling/form-audit`, opened 2026-10-05)

- The form-cleanup audit pages were built by scripts in `/tmp/form-cleanup-audits/`.
  The scripts are gone; only captures and `review-page/meta.json` (last rebuilt
  2026-10-02) survive, so the audit cannot be regenerated.
- **Resolve via:** if another audit is needed, rebuild the generator in the repo
  (a `form-audit` folder under `scripts/`) with a README and a `meta.json` that
  records the rebuild date (M).

### minimatch override (`tooling/minimatch-override`, opened 2026-11-11)

- `pnpm-workspace.yaml` overrides every minimatch from 7.0.0 up to 11.0.0 to
  `^11.0.1`, because all of them carry the denial-of-service advisory
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) and
  `@typescript-eslint/typescript-estree` still asks for 9.x or 10.x. This puts
  typescript-eslint on a minimatch major outside its declared range. It is a
  lint-time dependency only.
- **Resolve via:** remove the override once the installed typescript-eslint
  accepts minimatch `^11`, then confirm `pnpm why minimatch` lists no version
  from 7.0.0 up to 11.0.0 (S).

### Toolchain decisions requiring source review

Lint tooling (Biome 2 / oxlint vs ESLint 9), OpenAPI contract testing for the
Isometric client, Renovate vs Dependabot, and pnpm supply-chain guidance remain
open because they do not yet have source-backed recommendations. Vitest and
Playwright are already adopted and are not open decisions.
