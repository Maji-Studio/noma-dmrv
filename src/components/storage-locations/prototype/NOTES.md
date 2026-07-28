# Storage board prototype — THROWAWAY

**Question:** what should `/storage-locations` look like once the three
StatCards are gone, bin type becomes a filter, and the bin cards stop being
~200px tall for four facts?

**How to look:** `pnpm dev`, then
`http://localhost:3100/storage-locations?variant=A` (`current` | `A` | `B` |
`C`). The floating bar at the bottom cycles variants; `←` / `→` work too. It
never renders in a production build.

## What all three share

- **No StatCards.** The facility-wide on-hand roll-up moves into the type
  filter, which needed the number anyway. The server already returns
  `laneSummary` independently of the type filter, so the counts stay
  facility-wide however the list is filtered.
- **Type is a filter**, wired to the existing `type` predicate in
  `getStorageLocations` — server-side, so pagination stays honest.
- **The card loses its actions footer.** Reconcile moves into the ⋮ menu as a
  first item; that footer alone was ~50px per card.
- Per-bin masses stay fixed kg (`formatMassKg`), roll-ups stay auto-tonne
  (`formatMass`) — same rule as today.

## The three

| | shape | wins | loses |
| --- | --- | --- | --- |
| **A — Dense rows** | one flat framed list, ~52px rows, segmented type filter in the toolbar | scans like every other entity list; densest; holds up at 50 bins | no sense of the material flow; fill level is a small meter |
| **B — Compact lanes** | keeps feedstock → biochar → product columns; lane headers are the filter *and* the KPI strip; ~78px tiles | keeps the flow story operators already learned; picking a lane collapses to one full-width lane | three short columns waste horizontal space; degrades once a lane has 20 bins |
| **C — Gauge grid** | no grouping — sorted by attention (needs reconciliation → fullest → rest); filter rail on the left; each tile has a vertical silo gauge | answers "which bin needs me" fastest; a wall of tiles reads as a bar chart | throws away the flow story; the rail costs ~210px |

## Verdict

_(fill in — which variant, and which bits to graft from the others)_

## When done

Delete this folder and `src/components/prototype/`, drop the `?variant=`
plumbing + the `Suspense` boundary from `app/(app)/storage-locations/page.tsx`,
and rewrite the winner properly into `storage-location-list.tsx` (the variants
were written under prototype rules — no tests, no error handling).
