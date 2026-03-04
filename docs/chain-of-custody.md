# Chain of Custody Visualization

Interactive DAG (Directed Acyclic Graph) that shows the complete biochar traceability chain for a selected facility.

## Overview

The chain-of-custody page renders a React Flow graph with 12 entity nodes and 15 edges representing the full production-to-credit pipeline:

```text
Facility → Reactors, Storage Locations, Feedstock Deliveries,
           Production Runs, Biochar Products, Credit Batches
Feedstock Deliveries → Feedstocks
Feedstocks → Production Runs
Reactors → Production Runs
Production Runs → Samples, Biochar Products
Biochar Products → Orders
Orders → Deliveries
Deliveries → Applications
Applications → Credit Batches
```

## Architecture

Follows the standard layered pattern:

| Layer | File | Purpose |
|-------|------|---------|
| Data Access | `src/data-access/chain-of-custody.ts` | Queries entity counts grouped by status for a facility |
| Server Action | `src/fn/chain-of-custody.ts` | Validates input, calls data-access |
| React Query Hook | `src/hooks/use-chain-of-custody.ts` | Client-side caching (30s stale time) |
| Components | `src/components/chain-of-custody/` | React Flow visualization |
| Route | `src/app/(app)/chain-of-custody/page.tsx` | Page entry point |

## Components

### `ChainOfCustodyPage`
Main page component with header (title + facility dropdown) and React Flow canvas. Auto-selects the first facility on load.

### `ChainNode`
Custom React Flow node — 240x110px brutalist card with:
- Left accent bar (colored by entity group)
- Icon + uppercase monospace label
- Total count
- Status distribution bar (4px segmented bar)
- Status legend (top 3 statuses)

Empty nodes (total=0) render with dashed borders at 40% opacity. Clickable nodes navigate to entity list pages.

### `useChainGraph`
Transforms `ChainOfCustodyData` into React Flow nodes + edges using dagre for automatic LR (left-to-right) layout.

### `chain-constants.ts`
Static configuration:
- Node definitions (12 entities with icons, accent colors, routes)
- Edge definitions (15 connections)
- Status color mapping
- Layout constants (node size, dagre spacing)

## Visual Design

### Node Color Groups

| Group | Entities | Accent |
|-------|----------|--------|
| Infrastructure | Facilities, Reactors, Storage Locations | `--clr-purple` |
| Production | Feedstock Deliveries, Feedstocks, Production Runs, Samples, Biochar Products | `--clr-orange` |
| Distribution | Orders, Deliveries, Applications | `--clr-rose` |
| Credits | Credit Batches | `--clr-pink` |

### Edge Styling
- Purple stroke (`--clr-purple`) with arrow markers
- Smoothstep routing with offset to avoid overlapping node boxes
- Animated pulse when source entity has in-progress items

### Layout
- Dagre automatic hierarchical layout (LR direction)
- Node spacing: 60px vertical, 140px between ranks
- Fit-to-view with 15% padding
- Dotted grid background, zoom controls, minimap

## E2E Testing

Test file: `tests/e2e/chain-of-custody.spec.ts`

Tests cover:
- Page loads with header and populated facility dropdown
- Selecting a facility renders all 12 entity nodes
- Edges are rendered between nodes (15 connections)
- Seeded data shows correct non-zero counts on nodes
- Clickable nodes navigate to entity list pages
- Edges render with purple color theme
- Minimap and zoom controls are visible

### Running Tests
```bash
# Requires dev server running on port 3100
pnpm dev

# Run chain-of-custody tests
pnpm exec playwright test tests/e2e/chain-of-custody.spec.ts
```

### Fixtures Used
- `adminPage` — Pre-authenticated admin browser context
- `seededData` — Pre-populated facility, reactor, feedstocks, etc.
- `cleanupTestData` — Auto-cleanup after tests
