# Plausibility warnings are advisory

> **Current status: Accepted, not implemented** (reviewed 2026-07-29). No
> plausibility-rule configuration or immutable warning-acknowledgement model is
> present in the current schema/code. Existing submission warnings are not an
> implementation of this ADR's versioned rule/override/acknowledgement system.

Plausibility rules are authoritative on the server and may be previewed in the
client. Each rule has a versioned system default and may have an
Admin-managed Organization override; hard invariants never enter this
configurable system.

Proceeding past a warning requires an immutable acknowledgement that preserves
the rule/version, effective configuration, observed values, justification,
actor, and time. Acknowledged warnings appear on the affected record and in the
facility audit view, but do not become certification-readiness blockers,
registry evidence, or Chain-of-Custody Trail entries.
