# Isometric Requirements KB (Biochar + Soil Storage)

> **Non-authoritative.** All summaries are interpretations of Isometric sources. Always verify against linked registry URLs before implementing logic or making credit claims.

## Scope

- **In scope:** `biochar` pathway + `biochar-storage-soil-environments` storage module
- **Out of scope:** built-environment storage, low-oxygen storage, non-biochar pathways
- **Version authority:** `versions.json` is the single version pin file

## Files

| File | Purpose |
|---|---|
| `versions.json` | Protocol/module version pins, status, dates, authoritative URLs |
| `requirements-shortlist.md` | Concise requirement shortlist by domain with source links |
| `schema-mapping.md` | Requirement-to-schema coverage map and prioritized gaps |
| `p0-compliance-checklist.md` | Execution checklist for highest-priority implementation gaps |
| `simple-implementation-guide.md` | Plain-language implementation notes, derived-vs-stored decisions, and glossary |
| `condition-registry.md` | Canonical trigger map for `conditional_required` fields |
| `update-playbook.md` | Repeatable refresh workflow for version bumps |
| `changes.md` | Local changelog for documentation updates |

## How To Use

1. Check `versions.json` to confirm pinned versions.
2. Read `requirements-shortlist.md` for product/engineering decisions.
3. Use `schema-mapping.md` to identify implementation gaps.
4. Work through `p0-compliance-checklist.md` to close submission-critical gaps first.
5. Read `simple-implementation-guide.md` for plain-language context and abbreviations.
6. Use `condition-registry.md` to understand conditional field enforcement.
7. Follow `update-playbook.md` when protocol/module versions change.

## Update Rules

- Re-extract from Isometric MCP for every version bump.
- Keep summaries concise and source-linked.
- Core tables stay certifier-agnostic; certifier-specific mapping belongs in `certification_*` integration tables.

## Freshness

- Last refreshed: 2026-02-11
- Source of truth: Isometric Registry URLs in `versions.json`
