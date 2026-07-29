# Module seam verdicts: bin-stock guard escapes and production-run lifecycle purity

**Status:** RESOLVED (2026-07-29). Both questions were closed as "no deeper seam
needed" and removed from `docs/open-questions.md` under its rule that a resolved
entry leaves the file once the resolution is recorded in an owning doc. The seams
themselves are still live, so the rationale is preserved here. Revisit-when
triggers below are the conditions that would reopen either decision.

## Bin-stock guard escape controls remain wrapper-owned

Anchor: `src/data-access/bin-stock-guards.ts:assertBiocharProductDrawWithinStock`.

- **Verdict:** production callers set `skipBinLane`, `binLockAlreadyHeld`, and
  replacement-record exclusions only inside the owning `*-stock-locks.ts`
  modules. Direct imports elsewhere only lock or derive stock, translate the
  typed overdraw error, or run an invariant draw assertion without escape
  controls.
- **Owning seams:** `src/data-access/delivery-stock-locks.ts:lockDeliveryUpdateStock`,
  `src/data-access/biochar-product-stock-locks.ts:assertBiocharProductUpdateDraw`,
  `src/data-access/order-stock-locks.ts:assertOrderProductRepointWithinStock`,
  and
  `src/data-access/production-run-stock-locks.ts:assertProductionRunUpdateFeedstockDrawWithinStock`.
- **Why no deeper seam:** the stock-lock wrappers already contain configurable
  mutation coordination, while the shared guard's low-level invariant operations
  remain useful to reconciliation and create paths. Another facade would add
  indirection without containing any additional policy.
- **Revisit when:** a production caller outside `*-stock-locks.ts` supplies a
  guard skip/lock-held flag or replacement-record exclusion, or duplicates
  wrapper-owned lock ordering.

## Production-run lifecycle stays pure

Anchor: `src/lib/production-runs/lifecycle.ts:shouldIncludeProductionRunEndTime`.

- **Verdict:** the form's separate calls for allowed status options, end-time
  inclusion, and reopening clears are consistent projections of the same pure
  lifecycle policy. The mutation path independently merges persisted values and
  reasserts transitions and outcomes before writing, so persistence does not leak
  into the lifecycle module.
- **Related anchors:**
  `src/lib/production-runs/lifecycle.ts:allowedProductionRunStatusesFrom`,
  `src/lib/production-runs/lifecycle.ts:shouldClearProductionRunEndTime`,
  `src/components/production-runs/production-run-form.tsx:ProductionRunForm`,
  and `src/data-access/production-runs/mutations.ts:updateProductionRun`.
- **Why no deeper seam:** combining the calls would not remove duplicated policy
  or an inconsistent outcome; it would only couple form adaptation to data-access
  state. Keep `lifecycle.ts` free of `ctx`, transactions, and persistence.
- **Revisit when:** another adapter reimplements transition or outcome rules, two
  lifecycle projections disagree for the same transition, or an atomic
  persistence invariant cannot be enforced by the data-access mutation.
