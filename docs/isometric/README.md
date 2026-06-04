# Isometric Requirements KB (Biochar + Soil Storage)

> **Non-authoritative.** All summaries are interpretations of Isometric sources. Always verify against linked registry URLs before implementing logic or making credit claims.

## Scope

- **In scope:** `biochar` pathway + `biochar-storage-soil-environments` storage module
- **Out of scope:** built-environment storage, low-oxygen storage, non-biochar pathways
- **Version authority:** `versions.json` is the single version pin file

## Files

### Requirements knowledge base

| File | Purpose |
|---|---|
| `versions.json` | Protocol/module version pins, status, dates, authoritative URLs |
| `requirements-shortlist.md` | Concise requirement shortlist by domain with source links |
| `schema-mapping.md` | Requirement-to-schema coverage map and prioritized gaps |
| `p0-compliance-checklist.md` | Execution checklist for highest-priority implementation gaps |
| `simple-implementation-guide.md` | Plain-language implementation notes, derived-vs-stored decisions, glossary |
| `condition-registry.md` | Canonical trigger map for `conditional_required` fields |
| `update-playbook.md` | Repeatable refresh workflow for version bumps |

### Certify API integration

| File | Purpose |
|---|---|
| `integration-plan.md` | Forward-looking plan, phase status table, pre-deploy gates, architecture, idempotency design, migration ledger |
| `changes.md` | Append-only changelog of every shipped change |
| `sandbox-template-authoring.md` | Walkthrough for authoring the `noma-mvp` Removal Template in the sandbox Registry UI + fixed-constant bootstrap |
| `openapi-index.md` | Annotated index of every Certify + Registry OpenAPI operation/schema with current noma integration status |

Decisions live in `docs/adr/0001`–`0007`. Open design questions and
deferred work live in `docs/open-questions.md`.

## How To Use

### For requirements / compliance work

1. Check `versions.json` to confirm pinned versions.
2. Read `requirements-shortlist.md` for product/engineering decisions.
3. Use `schema-mapping.md` to identify implementation gaps.
4. Work through `p0-compliance-checklist.md` to close submission-critical gaps first.
5. Read `simple-implementation-guide.md` for plain-language context and abbreviations.
6. Use `condition-registry.md` to understand conditional field enforcement.
7. Follow `update-playbook.md` when protocol/module versions change.

### For integration work

1. Read `integration-plan.md` for the current model, phase status, and pre-deploy gates.
2. Skim the ADRs (`docs/adr/0001`–`0007`) for the design decisions.
3. Check `docs/open-questions.md` for active deferrals.
4. When changing the Certify surface, follow `update-playbook.md` and append to `changes.md`.

## Update Rules

- Re-extract from Isometric MCP for every version bump.
- Keep summaries concise and source-linked.
- Core tables stay certifier-agnostic; certifier-specific mapping belongs in `certification_*` integration tables.
- If an Isometric change affects schema, validation, or operator workflow, keep the relevant Playwright coverage passing before opening the PR.

## Freshness

- Requirements KB last refreshed: 2026-05-11
- Integration plan last refreshed: 2026-05-24
- Source of truth: Isometric Registry URLs in `versions.json`
