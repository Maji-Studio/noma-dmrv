# AGENTS.md

Compatibility instructions for coding agents working in `noma-dmrv`.

## Source Of Truth

`/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/.claude/CLAUDE.md` is the authoritative instruction file for this repository.

Read `./.claude/CLAUDE.md` before making changes. If this file and `CLAUDE.md` ever differ, `CLAUDE.md` wins.

This file is intentionally brief so agent guidance does not drift across two maintained documents.

## Non-Negotiables

- Use `pnpm` only.
- Do not bypass authentication or authorization checks. Enforce them in `src/data-access/`.
- Do not commit secrets, API keys, credentials, or `.env` files.
- Do not log PII such as names or email addresses. Prefer stable IDs.
- Do not let files grow past roughly 1000 lines. Split modules before adding more complexity.
- Do not hard-code reusable values or magic numbers. Extract constants near the top of the file or into `src/config/`.
- Do not add manual React memoization by default. This codebase uses the React Compiler.
- Keep `/docs` evergreen and move dated or implementation-log content to `docs/archive/`.

## Working Defaults

- Follow the existing layered flow: UI component -> `hooks/` -> `fn/` -> `data-access/` -> `db/`.
- Reuse existing entity CRUD patterns before inventing new abstractions.
- Use React Hook Form with Zod schemas in `src/schemas/`.
- Prefer targeted verification for touched areas, then broader checks when risk warrants it.

## Key References

- `./.claude/CLAUDE.md`
- `./docs/architecture.md`
- `./docs/forms.md`
- `./docs/organization.md`
- `./docs/security.md`
- `./docs/troubleshooting.md`
