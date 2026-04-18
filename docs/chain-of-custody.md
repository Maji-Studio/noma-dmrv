# Chain of Custody

The chain-of-custody page is now application-first.

Users select a single application and the page renders the upstream rollback path to the originating feedstock batches:

```text
Feedstock(s) + Reactor -> Production Run -> Biochar Product -> Order -> Delivery -> Application
```

If a link is missing, the page still renders the available lineage and shows a warning card explaining where the rollback stops.

## What The Page Does

- Lets the user search for an application directly from the page header.
- Resolves the facility from the selected application instead of requiring a facility-first graph.
- Renders one React Flow lineage graph for that application.
- Supports multiple feedstocks branching into the same production run.
- Keeps node links back to the relevant entity index pages.

## Architecture

| Layer | File | Purpose |
|-------|------|---------|
| Data Access | `src/data-access/chain-of-custody.ts` | Resolves upstream lineage for one application |
| Server Action | `src/fn/chain-of-custody.ts` | Validates the application id and returns lineage data |
| React Query Hook | `src/hooks/use-chain-of-custody.ts` | Caches lineage responses by application id |
| Selector Search | `src/data-access/entities.ts` | Adds `application` support to the shared `EntitySelect` |
| Components | `src/components/chain-of-custody/` | Application selector, lineage nodes, graph layout |
| Route | `src/app/(app)/chain-of-custody/page.tsx` | Page entry point |

## Graph Behavior

- `Feedstock` nodes show feedstock type, supplier, inbound delivery, and consumed mass.
- `Production Run` shows run date plus feedstock and biochar dry mass.
- `Biochar Product`, `Order`, `Delivery`, and `Application` show record-level details rather than aggregate counts.
- `Reactor` is shown as a sibling upstream input into the production run.

## Testing

Test file: `tests/e2e/chain-of-custody.spec.ts`

Coverage includes:

- Empty state before an application is selected
- Selecting an application through the shared entity selector
- Opening the page directly with an `application` query parameter
- Rendering the rollback graph through feedstock and reactor nodes
- Verifying node link targets
