# Method B unlock: the registry computes the unsampled estimate; noma gates, routes, and previews

Status: accepted (2026-06-20)

> **Refines ADR 0016** (credit batch = production batch; a production process scopes Method A/B).
> It does **not** supersede it. ADR 0016 laid the inert seam
> (`production_processes.{samplingMethod, established_at, method_b_unlocked_at}`) and shipped the
> Method-A behaviour; this ADR activates **Method B**. Stays inside **ADR 0013**'s boundary (noma
> submits raw inputs; the registry derives the credited number). Implementation record:
> [`docs/archive/2026-06-20-method-b-unlock.md`](../archive/2026-06-20-method-b-unlock.md).
>
> **Amendment (2026-07-12 — effective regime boundary):** a credit batch keeps the sampling
> regime in force when its production period begins. Unlocking Method B applies only to batches
> whose production period starts after `method_b_unlocked_at`; it never reclassifies an
> in-progress or historical Method-A batch. The boundary is batch start, not batch end, because
> the sampling plan must be known before production begins.
>
> **Amendment (2026-07-12 — submitted-evidence lock, target contract):** subject to the existing
> ≥30 baseline floor and normal validation, ordinary sample corrections remain directly editable
> until a submitted Removal/GHG Entry depends on the sample. Submission locks every contributing
> sample version, including a borrowed historical sample whose own credit batch or Removal is still
> draft. The lock follows certification dependency, not sample ownership; subsequent changes require
> a correction or supersession path rather than mutation of evidence already used by a submitted
> claim. This amendment records the decided contract only — the evidence-snapshot enforcement that
> implements the borrowed-sample lock is **not yet built** (deferred under `docs/open-questions.md`
> and #200/#391).
>
> **Amendment (2026-07-12 — process start):** `established_at` is the operator-entered date when
> the production process actually began operating, not database-row creation time. Back-entering a
> historical process is valid, but samples dated before its operational start never count toward the
> ≥30-sample Method-A baseline or its Method-B eligible pool.

## Context

ADR 0016 deferred the live Method-B compute on the premise that **DEC runs Method A everywhere**
indefinitely. That premise is now corrected: **DEC switches a production process to Method B once
it clears its 30-sample baseline.** Method B is the operating destination, so it must be built.

Biochar Protocol v1.3 ("Frequency of Measurement", verified verbatim 2026-06-20) fixes the rules:
the **production process** (per feedstock) carries a ≥ 30-sample Method-A baseline (`G-F74T-0`);
after it, Method B samples **≥ 1 batch per 10** (`G-2W0F-0`); unsampled batches are estimated
conservatively as `C = μ_CC − σ_CC/√n` (Eq 4/5) over **eligible samples** — those from the same
process in the **trailing 6 months**; measurements beyond `μ ± 3σ` are **winsorised**; sustained
deviation, a feedstock change, or a pyrolysis-condition change opens a **new process** that resets
the baseline to zero. Transitioning to Method B also forces a **moisture-pathway** declaration
(`R-ADXG-0`) and a **random-sampling plan** agreed with Isometric (`R-S8K1-1`).

The load-bearing question is **where the conservative-estimate math lives**. The handoff framed it
as noma's job. **ADR 0013 already decided the opposite**: noma submits the raw per-batch samples and
the registry computes the durable fraction — "the registry takes the mean (`_c_org`) or Winsorized
mean + standard error (`_unsampled`)." Re-implementing Eq 4/5 + winsorisation as a *submitted* value
would re-open 0013 and re-create the audit-defeating posture it exists to remove.

## Decision

1. **The registry computes the unsampled estimate; noma does not.** Per ADR 0013, noma submits the
   raw per-credit-batch sample datapoints; the registry applies Eq 4/5 + 3σ winsorisation over the
   eligible-sample pool. noma's role for Method B is **gating + submission routing + a labelled,
   non-authoritative preview** — never credit-bearing math. The borrow-pool granularity question is
   **dissolved**: the protocol fixes the pool at the **production process**, and noma never asserts a
   pooling choice for crediting. At submission, noma records the contributing eligible sample
   versions so the evidence dependency can be enforced and audited.

2. **Unlock is eligible-then-act, not auto-flip.** At ≥ 30 qualifying Method-A baseline samples
   (counted in the process since its operator-entered operational `established_at`) a process
   surfaces as *eligible for unlock*; samples before that lower bound are excluded even when the
   process was back-entered later. A deliberate **unlock action** flips
   `sampling_method → method_b`, stamps `method_b_unlocked_at`, and **captures three protocol
   prerequisites a sample count cannot infer**: the Isometric-agreed baseline number (≥ 30,
   default 30), a random-sampling-plan reference, and the moisture pathway. The seam is a *timestamp*
   precisely because the switch carries state.

   The timestamp is also the effective regime boundary. A credit batch whose production period
   began before the unlock remains Method A, including a batch still in progress when the unlock
   occurs. Only batches beginning after the timestamp use Method B.

3. **Facility managers may unlock** (not super-admin only). The guardrail is the mandatory
   prerequisite capture plus a persistent, protocol-cited **explanation surface** shown when
   `certifier = 'isometric'`, forcing acknowledgement that the off-system Isometric agreement exists.

4. **Carbon drift is surfaced, never auto-actioned.** Because noma submits raw samples (D1), the
   **registry is the detector of record** for outliers and sustained deviation. noma tracks the two
   compliance counters (missed samplings; sub-3σ measurements, trailing 6 mo) and warns; opening a
   **new production process** (which resets the baseline → Method A) is a deliberate human action.

5. **Moisture stays "measured every batch."** noma already records per-run biochar moisture; the
   unlock only records the *declared* `R-ADXG-0` pathway. The SEM-monitored consistent-moisture
   pathway is out of scope.

6. **Method-B/eligibility enforcement re-grains to the production process** (Track 1): the
   eligibility read moves `…ByReactor → …ByProcess`, counting eligible samples since `established_at`
   — closing a latent **cross-feedstock over-credit bug** (a reactor's samples currently count across
   feedstocks). This is Method-A-safe and ships independently of the unlock.

## Considered options

- **noma computes + submits the unsampled estimate** (the handoff's framing) — rejected: re-opens
  ADR 0013, makes a credited number noma-asserted rather than registry-derived, and goes stale on a
  protocol coefficient bump.
- **Auto-flip to Method B at 30 samples** — rejected: the count is necessary but not sufficient
  (Isometric consultation, a random-sampling plan, and the `R-ADXG-0` moisture declaration must
  accompany the switch); encodes a transition the protocol does not permit unsupervised.
- **Super-admin-only unlock** — rejected by DEC operating preference; replaced by facility-manager
  unlock + mandatory captures + explanation surface as the guardrail.
- **Auto-create a new process on 3σ drift** — rejected: a measurement error could wipe a hard-won
  baseline; the registry is the authority and a reset is consequential, so it stays human-confirmed.

## Consequences

- ADR 0017 Track 1 ships the process-grained Method-B baseline counter and the read-only
  `/production-processes` surface; Method B itself remains inert until Track 2.
- Track 2 adds the explicit unlock action, prerequisite capture, and process-grain defense-in-depth
  backstop before any Method-B submission route becomes reachable.
- Any `_unsampled` submission route stays sandbox-gated until its wire format is verified against the
  current Isometric registry contract.
- noma may show a non-authoritative Method-B preview, but credited Eq 4/5 and winsorisation remain
  registry-derived per ADR 0013.
- A submitted unsampled Removal dependency-locks its contributing sample versions (target
  contract — enforcement pending per the 2026-07-12 amendment). Method-B unlock alone does not
  freeze ordinary corrections, although the ≥30 baseline-floor invariant remains; an unclaimed
  sample has no submission lock.
- **Glossary:** `CONTEXT.md` distinguishes **Method-B baseline** (the ≥30-sample unlock
  prerequisite), **Eligible sample** (the trailing-6-mo process pool), and **Method-B evidence
  snapshot** (the sample versions used by a submitted unsampled Removal).

All Isometric protocol references are non-authoritative summaries of text verified 2026-06-20;
re-verify against <https://registry.isometric.com/protocol/biochar/1.3> before encoding credit logic.
