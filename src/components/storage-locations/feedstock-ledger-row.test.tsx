import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { FeedstockLedgerEntry } from "@/types/feedstock-bin-ledger";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));

import { FeedstockLedgerRow } from "./feedstock-ledger-row";

const AT = "2026-10-01T12:00:00.000Z";
const MOVED_AT = "2026-10-01T14:00:00.000Z";
const FACILITY_ID = "00000000-0000-4000-8000-000000000002";
const LOCKED = "Correction blocked by a later production run: PR-26-001 (Oct 1, 2026, 13:00).";

function entry(values: Partial<FeedstockLedgerEntry> = {}): FeedstockLedgerEntry {
  return { id: "loss", sourceId: null, kind: "loss", occurredAt: AT, recordedAt: AT, actorName: "Asha", code: null, reason: "Spilled",
    wetDeltaKg: -120, countedWetKg: null, moisturePercent: null, beforeWetKg: 1000, afterWetKg: 880, estimatedDryKg: null,
    editLockedReason: null, ...values };
}
function text(node: ReactTestInstance | string): string { return typeof node === "string" ? node : node.children.map(text).join(" "); }
function buttons(renderer: ReactTestRenderer): string[] { return renderer.root.findAllByType("button").map(text); }
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

async function render(row: FeedstockLedgerEntry, corrected?: FeedstockLedgerEntry, handlers = { onEdit: vi.fn(), onDelete: vi.fn() }) {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FeedstockLedgerRow entry={row} corrected={corrected} timeZone="UTC" facilityId={FACILITY_ID} {...handlers} />); });
  return { renderer, ...handlers };
}

it("offers Edit and Delete on an editable Lost mass entry and hands the entry over", async () => {
  const row = entry();
  const { renderer, onEdit, onDelete } = await render(row);
  expect(buttons(renderer)).toEqual(["Edit", "Delete"]);
  await act(async () => renderer.root.findAllByType("button")[0].props.onClick());
  await act(async () => renderer.root.findAllByType("button")[1].props.onClick());
  expect(onEdit).toHaveBeenCalledWith(row);
  expect(onDelete).toHaveBeenCalledWith(row);
});

it("explains a locked entry instead of offering actions", async () => {
  const { renderer } = await render(entry({ editLockedReason: LOCKED }));
  expect(buttons(renderer)).toEqual([]);
  expect(text(renderer.root)).toContain(LOCKED);
});

it("strikes a replaced entry and offers nothing on it", async () => {
  const { renderer } = await render(entry({ reversed: true, editLockedReason: undefined,
    reversedBy: { id: "rev", reason: "Weighed again", recordedAt: MOVED_AT, actorName: "Asha", replacementId: "fix" } }));
  const markup = text(renderer.root);
  expect(markup).toContain("Replaced");
  expect(markup).toContain("It no longer counts toward the stock.");
  expect(buttons(renderer)).toEqual([]);
});

it("names who deleted an entry and why", async () => {
  const { renderer } = await render(entry({ reversed: true, editLockedReason: undefined,
    reversedBy: { id: "rev", reason: "Recorded twice", recordedAt: MOVED_AT, actorName: "Asha", replacementId: null } }));
  const markup = text(renderer.root);
  expect(markup).toContain("Reversed");
  expect(markup).toContain("by Asha");
  expect(markup).toContain("Why deleted");
  expect(markup).toContain("Recorded twice");
});

it("shows a correction as Original to Corrected, with times only when it moved", async () => {
  const original = entry({ reversed: true });
  const same = await render(entry({ id: "fix", correctsMovementId: "loss", wetDeltaKg: -80, reason: "Weighed again" }), original);
  const sameText = text(same.renderer.root);
  expect(sameText).toContain("Correction");
  expect(sameText).toContain("Original");
  expect(sameText).toContain("Why corrected");
  expect(sameText.match(/Oct 1, 2026, 12:00/g)).toHaveLength(1);
  const moved = await render(entry({ id: "fix", correctsMovementId: "loss", occurredAt: MOVED_AT, wetDeltaKg: -80 }), original);
  expect(text(moved.renderer.root)).toContain("Oct 1, 2026, 14:00");
});
