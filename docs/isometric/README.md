# Isometric Requirements KB (Biochar + Soil Storage)

## Warning
Do not trust summaries without source links.  
All summaries in this folder are **non-authoritative interpretations** of Isometric sources.

## Purpose
Maintain a local, low-token requirements knowledge base for:
- Biochar protocol pathway
- Biochar storage in soil environments
- Cross-cutting modules used by this pathway

## Scope
- In scope: `biochar` + `biochar-storage-soil-environments`
- Out of scope (for now): built-environment storage, low-oxygen storage, non-biochar pathways
- Version authority: `versions.json` is the single version pin file

## Files
- `versions.json`: protocol/module version pins, status, dates, authoritative URLs
- `requirements-shortlist.md`: concise requirement shortlist by domain
- `schema-mapping.md`: requirement-to-schema coverage map and prioritized gaps
- `update-playbook.md`: repeatable update workflow
- `changes.md`: local changelog format for future bumps

## How To Use
1. Start with `versions.json` to confirm what is pinned.
2. Use `requirements-shortlist.md` for product/engineering decisions.
3. Use `schema-mapping.md` to prioritize implementation gaps.
4. Follow `update-playbook.md` when protocol/module versions change.

## Update Rule
- Re-extract from Isometric MCP for every version bump.
- Keep summaries concise and source-linked.
- Keep core tables certifier-agnostic; certifier-specific mapping belongs in `isometric_*` integration tables.

## Freshness
- Last refreshed (UTC): `2026-02-09T15:34:40Z`
- Source of truth: Isometric Registry URLs listed in `versions.json`
