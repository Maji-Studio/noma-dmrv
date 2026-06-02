# ADR Format

ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.

Create the `docs/adr/` directory lazily, only when the first ADR is needed.

## Template

```md
# {Short title of the decision}

{1-3 sentences: what is the context, what did we decide, and why.}
```

That is it. An ADR can be a single paragraph. The value is in recording that a decision was made and why, not in filling out sections.

## Optional Sections

Only include these when they add genuine value. Most ADRs do not need them.

- Status frontmatter: `proposed`, `accepted`, `deprecated`, or `superseded by ADR-NNNN`. Useful when decisions are revisited.
- Considered Options: only when the rejected alternatives are worth remembering.
- Consequences: only when non-obvious downstream effects need to be called out.

## Numbering

Scan `docs/adr/` for the highest existing number and increment by one.

## When To Offer An ADR

All three of these must be true:

1. Hard to reverse: the cost of changing your mind later is meaningful.
2. Surprising without context: a future reader will wonder why it was done this way.
3. Result of a real trade-off: there were genuine alternatives and one was picked for specific reasons.

If a decision is easy to reverse, skip it. If it is not surprising, nobody will wonder why. If there was no real alternative, there is nothing to record beyond the obvious.

## What Qualifies

- Architectural shape, such as choosing a monorepo or event-sourced write model.
- Integration patterns between contexts, such as domain events instead of synchronous HTTP.
- Technology choices that carry lock-in, such as database, message bus, auth provider, or deployment target.
- Boundary and scope decisions, such as owning customer data in one context and referencing it by ID elsewhere.
- Deliberate deviations from the obvious path, such as using manual SQL instead of an ORM for a specific reason.
- Constraints not visible in the code, such as compliance restrictions or partner API latency commitments.
- Rejected alternatives when the rejection is non-obvious.
