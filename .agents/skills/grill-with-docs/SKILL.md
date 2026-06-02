---
name: grill-with-docs
description: Grilling session that challenges a plan against the existing domain model, sharpens terminology, and updates documentation such as CONTEXT.md and ADRs inline as decisions crystallize. Use when the user wants to stress-test a plan against the project's language and documented decisions.
---

## What To Do

Interview the user relentlessly about every aspect of the plan until you reach a shared understanding.

Walk down each branch of the design tree, resolving dependencies between decisions one by one. For each question, provide your recommended answer.

Ask questions one at a time and wait for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Domain Awareness

During codebase exploration, also look for existing documentation.

Most repos have a single context:

```text
/
|- CONTEXT.md
|- docs/
|  `- adr/
|     |- 0001-event-sourced-orders.md
|     `- 0002-postgres-for-write-model.md
`- src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```text
/
|- CONTEXT-MAP.md
|- docs/
|  `- adr/                          # system-wide decisions
`- src/
   |- ordering/
   |  |- CONTEXT.md
   |  `- docs/adr/                  # context-specific decisions
   `- billing/
      |- CONTEXT.md
      `- docs/adr/
```

Create files lazily, only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

## During The Session

Challenge against the glossary. When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately.

Sharpen fuzzy language. When the user uses vague or overloaded terms, propose a precise canonical term.

Discuss concrete scenarios. When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force precision about the boundaries between concepts.

Cross-reference with code. When the user states how something works, check whether the code agrees. If you find a contradiction, surface it.

Update `CONTEXT.md` inline when a term is resolved. Do not batch these updates. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, scratch pad, or repository for implementation decisions. It is a glossary and nothing else.

Offer ADRs sparingly. Only offer to create an ADR when all three are true:

1. Hard to reverse: the cost of changing your mind later is meaningful.
2. Surprising without context: a future reader will wonder why it was done this way.
3. Result of a real trade-off: there were genuine alternatives and one was picked for specific reasons.

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).
