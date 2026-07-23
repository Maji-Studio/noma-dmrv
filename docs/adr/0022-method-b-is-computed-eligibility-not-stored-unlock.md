---
status: accepted
supersedes: partially ADR-0017 (Track 2 — the unlock ceremony)
---

# Method B is computed eligibility, not a stored unlock

Research against the live Isometric registry (Biochar Protocol v1.3 §8.3.1,
§8.3.1.2) showed the Certify API has no sampling-method field: Method A/B
surfaces only as per-batch blueprint routing (sampled → `_c_org`, unsampled →
`_unsampled`), and the registry owns all Method-B math (ADR 0013). A stored
per-process `samplingMethod` + `methodBUnlockedAt` flip, DB trigger backstops,
advisory locks, and operational-start locking existed only to protect state the
protocol never asked us to persist.

We therefore removed the unlock ceremony. Each **credit batch** stores its own
sampled/unsampled choice, fixed at creation (the regime-boundary rule from the
ADR 0017 amendment stands). "Unsampled" is selectable only when computed live:
eligible samples since the current process epoch ≥ the agreed baseline
(floor 30) AND the three Method-B prerequisites are recorded. The
`production_processes` table survives only as the irreducible per-(facility,
feedstock type) marker: the process epoch (`establishedAt`, human-reset via
"Start new process") plus the three prerequisites (`agreedBaselineSize`,
`randomSamplingPlanRef`, `moisturePathway`) — off-system Isometric agreements a
sample count cannot infer. Recording the prerequisites is an owner/admin-only
action and is the entire "admin unlocks Method B" gate; there is no flag.

Consequences: the baseline-floor deletion invariant is gone (if the live count
falls below threshold, new unsampled batches grey out; existing batches keep
their fixed choice). Drift/compliance-trigger monitoring ships with **no in-app
warnings** — the protocol makes it an operator obligation and Isometric's
registry is the detector of record (ADR 0017 D6); it is documented as an
operator duty instead. The sampling surface only exists for Isometric-connected
organizations. ADR 0016 (process scopes sampling, batch = production batch) and
ADR 0017 Track 1 (registry computes, noma previews) stand.
