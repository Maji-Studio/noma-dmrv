/**
 * Stage 2 public contract (both exports are client-safe):
 * findFeedstockLossBlocker(entries: readonly FeedstockLedgerEntry[], entryId: string): FeedstockLedgerEntry | null
 * formatFeedstockLossLockReason(blocker: FeedstockLedgerEntry, timeZone: string): string
 * Entries are already ordered by occurredAt, recordedAt, id; entryId names an
 * existing loss. Return the first later withdrawal, the target itself if it is
 * reversed, or null when editable. A reversed target gets already-corrected copy.
 */
import { describe, expect, it } from "vitest";
import { findFeedstockLossBlocker, formatFeedstockLossLockReason } from "@/lib/feedstock-loss-lock";
import { formatFacilityDateTime } from "@/lib/format-utils";
import type { FeedstockLedgerEntry } from "@/types/feedstock-bin-ledger";

const EARLY = "2026-01-01T08:00:00.000Z";
const AT = "2026-01-01T10:00:00.000Z";
const LATE = "2026-01-01T12:00:00.000Z";
const TIME_ZONE = "Africa/Dar_es_Salaam";
const LOSS_KG = 120;
const INITIAL_KG = 1000;
const AFTER_LOSS_KG = 880;
const GUIDANCE = "Correct or remove the records that use it first.";

function entry(overrides: Partial<FeedstockLedgerEntry> = {}): FeedstockLedgerEntry {
  return {
    id: "loss", sourceId: null, kind: "loss", occurredAt: AT, recordedAt: AT,
    actorName: null, code: null, reason: "Spillage", wetDeltaKg: -LOSS_KG,
    countedWetKg: null, moisturePercent: null, beforeWetKg: INITIAL_KG,
    afterWetKg: AFTER_LOSS_KG, estimatedDryKg: null, ...overrides,
  };
}

describe("feedstock Lost mass record lock", () => {
  it("leaves a loss editable when nothing follows it", () => {
    const loss = entry();
    expect(findFeedstockLossBlocker([loss], loss.id)).toBeNull();
  });

  it.each(["run_draw", "ingredient_draw", "loss", "count"] as const)(
    "locks on a later %s withdrawal", (kind) => {
      const loss = entry();
      const later = entry({ id: "later", kind, occurredAt: LATE });
      expect(findFeedstockLossBlocker([loss, later], loss.id)).toEqual(later);
    },
  );

  it.each(["run_draw", "ingredient_draw", "loss", "count"] as const)(
    "ignores an earlier %s withdrawal", (kind) => {
      const loss = entry();
      const earlier = entry({ id: "earlier", kind, occurredAt: EARLY });
      expect(findFeedstockLossBlocker([earlier, loss], loss.id)).toBeNull();
    },
  );

  it("ignores later intakes and zero or positive stock counts", () => {
    const loss = entry();
    const later = [
      entry({ id: "a-intake", kind: "intake", wetDeltaKg: INITIAL_KG, occurredAt: LATE }),
      entry({ id: "b-unchanged", kind: "count", wetDeltaKg: 0, occurredAt: LATE }),
      entry({ id: "c-positive", kind: "count", wetDeltaKg: LOSS_KG, occurredAt: LATE }),
    ];
    expect(findFeedstockLossBlocker([loss, ...later], loss.id)).toBeNull();
  });

  it.each(["ingredient_draw", "loss"] as const)("ignores a reversed later %s", (kind) => {
    const loss = entry();
    const later = entry({ id: "reversed", kind, occurredAt: LATE, reversed: true });
    expect(findFeedstockLossBlocker([loss, later], loss.id)).toBeNull();
  });

  it("returns the first live withdrawal after skipping additions and reversals", () => {
    const loss = entry();
    const intake = entry({ id: "a-intake", kind: "intake", occurredAt: LATE, wetDeltaKg: INITIAL_KG });
    const reversed = entry({ id: "b-reversed", occurredAt: LATE, reversed: true });
    const first = entry({ id: "c-first", kind: "run_draw", occurredAt: LATE });
    const second = entry({ id: "d-second", kind: "count", occurredAt: LATE });
    expect(findFeedstockLossBlocker([loss, intake, reversed, first, second], loss.id)).toEqual(first);
  });

  it("uses recorded order when event times tie, even if ids sort the other way", () => {
    const before = entry({ id: "z", kind: "run_draw", recordedAt: EARLY });
    const loss = entry({ id: "m" });
    const after = entry({ id: "a", kind: "run_draw", recordedAt: LATE });
    expect(findFeedstockLossBlocker([before, loss], loss.id)).toBeNull();
    expect(findFeedstockLossBlocker([before, loss, after], loss.id)).toEqual(after);
  });

  it("uses id order when event and recorded times both tie", () => {
    const before = entry({ id: "a", kind: "run_draw" });
    const loss = entry({ id: "m" });
    const after = entry({ id: "z", kind: "run_draw" });
    expect(findFeedstockLossBlocker([before, loss], loss.id)).toBeNull();
    expect(findFeedstockLossBlocker([before, loss, after], loss.id)).toEqual(after);
  });

  it("keeps an already reversed loss locked even without a later withdrawal", () => {
    const loss = entry({ reversed: true });
    expect(findFeedstockLossBlocker([loss], loss.id)).toEqual(loss);
    expect(formatFeedstockLossLockReason(loss, TIME_ZONE)).toMatch(/already.*corrected/i);
  });

  it("allows the live replacement of a reversed loss to be corrected", () => {
    const original = entry({ reversed: true });
    const replacement = { ...entry({ id: "replacement", occurredAt: LATE }), correctsMovementId: original.id };
    expect(findFeedstockLossBlocker([original, replacement], replacement.id)).toBeNull();
  });
});

describe("feedstock Lost mass lock guidance", () => {
  it.each([
    { kind: "run_draw", label: "production run", holder: "production run", code: "PR-001", sourceId: "run" },
    { kind: "ingredient_draw", label: "product ingredient", holder: "biochar product", code: "BP-001", sourceId: "product" },
    { kind: "loss", label: "lost mass", holder: "stock entry", code: null, sourceId: null },
    { kind: "count", label: "stock count", holder: "stock entry", code: null, sourceId: null },
  ] as const)("names the later $label and how to free it", ({ kind, label, holder, code, sourceId }) => {
    const blocker = entry({ kind, sourceId, code, occurredAt: LATE });
    const message = formatFeedstockLossLockReason(blocker, TIME_ZONE);
    expect(message).toBe(
      `Correction blocked by a later ${label}: ${code ?? blocker.reason} (${formatFacilityDateTime(LATE, TIME_ZONE)}).` +
      ` Held by ${code ? `${holder} ${code}` : `a ${holder}`}. ${GUIDANCE}`,
    );
    expect(message).not.toMatch(/[\u2013\u2014]/);
  });

  it("formats the event time in the facility zone, not the recorded time", () => {
    const blocker = entry({ kind: "run_draw", code: "PR-001", occurredAt: LATE, recordedAt: EARLY });
    const message = formatFeedstockLossLockReason(blocker, TIME_ZONE);
    expect(message).toContain(formatFacilityDateTime(LATE, TIME_ZONE));
    expect(message).not.toContain(formatFacilityDateTime(EARLY, TIME_ZONE));
    expect(message).not.toBe(formatFeedstockLossLockReason(blocker, "UTC"));
  });
});
