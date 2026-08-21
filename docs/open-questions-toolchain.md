# Toolchain Open Questions

This companion holds tooling and dependency upgrade decisions split out of
[open-questions.md](./open-questions.md). Read it before changing the project's
compiler, ORM, build, lint, or dependency-management toolchain; the parent
document's schema, invariants, and resolution rules apply here.

## Tooling & toolchain upgrades (research pass, opened 2026-06-12)

Verified findings from a sourced research sweep (Next 16 / TS 7 / Drizzle v1,
mid-2026). Already confirmed fine: Turbopack default (no stale flags, no webpack
config), `reactCompiler: true` opt-in, `src/proxy.ts` rename, generate+migrate CI
workflow.

### TypeScript 7 (tsgo) for CI typecheck (`tooling/ts7`)

- Still open: `package.json` pins TS `^5.9.3` and there is no `tsgo` anywhere.
- **Resolve via:** add a non-blocking `tsgo --noEmit` CI job to validate parity
  against the large Drizzle schema and Zod-heavy types; flip the blocking typecheck
  once TS 7 ships stable (S).

### Drizzle ORM/Kit v1.0 upgrade (`db/drizzle-v1`)

- v1 was at `1.0.0-rc.3` (stable line still 0.45.x). Bundles a full drizzle-kit
  rewrite (with materially faster introspection for a schema of this size), migrations folder
  v3 (journal.json removed, per-migration folders, ends git conflicts on
  migrations), and Relational Queries v2 (breaking; official v1→v2 guide).
  Release notes warn "something will definitely break".
- **Resolve via:** do NOT adopt at RC. When stable ships, use a dedicated
  upgrade branch; the no-prod-data reseed-over-migrate stance makes the
  migrations-folder restructure cheap if done before launch (M).

### Cache Components pilot (`app/cache-components`)

- Next 16 caching is fully opt-in via `cacheComponents: true` (`'use cache'` +
  PPR model; `cacheLife`/`cacheTag` stable, old PPR flags removed). For an
  auth-gated, org-scoped app there's no urgency, and no verified real-world
  adoption evidence for auth-heavy apps yet. See
  [`docs/modern-patterns.md`](./modern-patterns.md).
- **Resolve via:** a selective pilot on read-heavy views (dashboard,
  chain-of-custody roll-ups) when perf data justifies it; not codebase-wide (M).

### Unverified research areas needing a follow-up pass

Lint tooling (Biome 2 / oxlint vs ESLint 9), OpenAPI contract testing for the
Isometric client, Renovate vs Dependabot, pnpm supply-chain guidance — the sweep
produced no adversarially-verified claims in these areas. (Vitest 4 and
Playwright 1.58+ were on this list and are both already adopted — `vitest`
`^4.1.0`, `@playwright/test` `^1.58.2`.)
