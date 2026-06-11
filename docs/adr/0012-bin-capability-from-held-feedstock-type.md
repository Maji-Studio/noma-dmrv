# Bin capability derives from the held feedstock type's usage

Status: accepted (2026-06-11)

Storage bins originally carried a type enum (`feedstock_bin`, `ingredient_bin`, …) and
draw-gating keyed off it: production runs could only consume from `feedstock_bin`,
biochar-product formulations from `ingredient_bin`. User testing (#114, #115) showed the
input-bin split is artificial — operators store pyrolysis biomass in bins that happen to be
typed "ingredient" and get blocked for no domain reason, and the two names for the same
physical thing caused exactly the confusion #115 reports.

**Decision:** an input bin has no behavioral kind of its own. `feedstock_bin` and
`ingredient_bin` merge into a single input-bin value; what a bin may feed follows from the
**declared usage of the feedstock type it holds** (set at creation or locked on first
intake): *pyrolysis*-usage stock may enter a production run, *blend*-usage stock may enter a
formulation. Output bins (`biochar_bin`, `product_bin`) are unaffected — they hold lots and
products, not feedstock types, and remain distinct.

This keeps registry eligibility protected at the right place: pyrolysis-usage feedstock
types are certifier-validated (CONTEXT.md → *Feedstock type*), so gating on the type's usage
is gating on eligibility itself, whereas the bin enum only ever gated on a label.

## Considered options

- **Keep both enum values as labels with no behavioral meaning** — rejected: two names for
  one concept invites drift and re-creates the reported confusion.
- **Collapse all bin types into one** — rejected: output bins genuinely differ (contents are
  lots/products, not feedstock types); over-reach for the problem.

## Consequences

- UI labels bins by *what they hold* (held feedstock type + usage badge), not by bin type
  (#115).
- "Ingredient bin" survives in the glossary as descriptive shorthand only — a bin currently
  holding a blend-usage type.
- Schema change lands by reseed, not migration (no production data yet).
