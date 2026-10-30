# Isometric update playbook

Read this before refreshing the protocol pin, registry observations or generated
Certify types. Keep a dated evidence trail and one owner per topic. These docs
remain non-authoritative; a code check cannot confirm a registry requirement.

## Verify authority first

1. Call official Isometric MCP `how_to` before registry/protocol claims.
2. For pinned slugs in [versions.json](./versions.json), fetch metadata and
   confirm certified status, minor/patch versions, publication/certification
   dates and tagged authoritative URLs. Do not bump the project's minor pin
   without an explicit decision.
3. Read the relevant protocol/module content; fetch every page before drawing
   conclusions. Use targeted analysis to locate sections, then verify the text.
4. Check the account/environment before probing the sandbox project. The MCP
   GraphQL account may see a different environment from local Certify keys.
5. If authentication or tools are unavailable, state the verification gap and
   retain historical dates. Do not mark local summaries as registry-confirmed.

## Update the owning documents

- Change pins in `versions.json` first, then update only affected requirement
  rows with section references and authoritative URLs.
- Check actual schemas, builders, gates and tests before changing coverage in
  [schema mapping](./schema-mapping.md), [checklist](./p0-compliance-checklist.md)
  or [conditions](./condition-registry.md). A table column is not a complete gate.
- Record API quirks in [registry behavior](./registry-behavior.md), including
  environment, date, request variations, response and verification limits.
- Remove resolved questions from [open questions](../open-questions-isometric.md)
  only when code or authoritative evidence resolves them. Put the durable rule
  in its owning guide/ADR, not in a growing resolution log.
- Put implementation history in the archive, linked from [changes](./changes.md).
  Preserve existing history until its archive move is approved.
- Keep code-owned field/mapping inventories in code. Docs explain intent,
  ownership, gaps and traps, with links to the implementation.

## Regenerate Certify types

The source URL is pinned by `regenerate-certify-types` in `package.json` and
`ISOMETRIC_OPENAPI_URL` in `.github/workflows/isometric-health.yml`:
`https://docs.isometric.com/api-reference/certify/mrv.openapi.json`.
The historical API-root `/openapi.json` serves another spec; do not substitute it.

```bash
pnpm regenerate-certify-types
git diff src/lib/isometric/generated/certify.d.ts
```

Review operation changes and non-test consumers before updating the
[API index](./openapi-index.md). Generated operation counts are not a freshness
or compliance signal. Template fixture mode still calls live services.

## Validate and review

Run `pnpm docs:check`, check relative links/anchors and referenced code paths,
then run the repository static gates. For implementation behavior, run the
relevant tests; protocol changes affecting workflows also need the matching E2E
paths. A docs-only cleanup does not require an application behavior change.

Review before/after claims and verification dates. Keep peer-owned sections
untouched until their PR merges, then rebase and reconcile them before landing.
Never present a successful coverage check as proof of full protocol compliance.
