# Quality-assurance workspace

This directory holds reusable QA instructions and, when needed, evidence that
describes the current build rather than a past run.

Keep live:

- reusable prompts such as
  [`computer-use-ux-reviewer-prompt.md`](./computer-use-ux-reviewer-prompt.md)
  and the coordinated prompts under [`prompts/`](./prompts/);
- concise current evidence only while it remains representative and is linked
  from an active issue, plan, or evergreen document.

Move dated run reports, blocker ledgers, screenshots, and other point-in-time
artifact bundles to [`docs/archive/qa/`](../archive/qa/) after the run is
complete or superseded. Preserve the report and its unique evidence together.
Archived QA is historical evidence, not a statement about the current
environment or release readiness.

Active docs must not claim that local-only or uncommitted evidence is available.
Reports may describe such evidence truthfully after they are archived.
