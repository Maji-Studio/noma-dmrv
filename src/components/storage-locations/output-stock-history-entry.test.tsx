import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { STOCK_HISTORY_HINT } from "@/lib/output-stock/labels";
import type { OutputStockHistoryEntry } from "@/types/output-stock";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));

import { buildHistoryDays } from "./output-stock-history-days";
import { HistoryEntry } from "./output-stock-history-entry";

const AT = "2026-09-15T12:00:00.000Z";
const FACILITY_ID = "00000000-0000-4000-8000-000000000002";
const SAVED_LINE = "Wet mass +10 kg. A later entry changed this estimate.";

function entry(values: Partial<OutputStockHistoryEntry> & Pick<OutputStockHistoryEntry, "id" | "kind">): OutputStockHistoryEntry {
  return { occurredAt: AT, recordedAt: AT, actorName: "Asha", reason: "", wetMassKg: null, moisturePercent: 50, dryMassKg: 0,
    beforeDryKg: 0, afterDryKg: 0, correctsMovementId: null, deliveryId: null, allocations: [], ...values };
}
function text(node: ReactTestInstance | string): string { return typeof node === "string" ? node : node.children.map(text).join(" "); }
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

/** A bin of 300 kg wet, then a Lost mass of 50 kg wet whose recomputed change is `wetDeltaKg`. */
async function renderLoss(loss: Partial<OutputStockHistoryEntry>): Promise<string> {
  const placed = entry({ id: "p1", kind: "intake", occurredAt: "2026-09-14T12:00:00.000Z", wetMassKg: 300, dryMassKg: -150, wetDeltaKg: 300, solidsDeltaKg: 150 });
  const lost = entry({ id: "l1", kind: "loss", eventKind: "loss", wetMassKg: 50, dryMassKg: 25, solidsDeltaKg: -25, ...loss });
  const row = buildHistoryDays([placed, lost], "UTC").flatMap((day) => day.rows).find((candidate) => candidate.entry.id === "l1")!;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<HistoryEntry row={row} defaultOpen linked timeZone="UTC" facilityId={FACILITY_ID} onEdit={vi.fn()} onDelete={vi.fn()} />);
  });
  return text(renderer.root);
}

describe("HistoryEntry when saved", () => {
  it("shows the saved wet change when a later entry moved the estimate", async () => {
    const output = await renderLoss({ wetDeltaKg: -50, savedWetDeltaKg: 10 });
    expect(output).toContain("When saved");
    expect(output).toContain(SAVED_LINE);
  });

  it("shows nothing when the saved and current wet change are equal", async () => {
    expect(await renderLoss({ wetDeltaKg: -50, savedWetDeltaKg: -50 })).not.toContain("When saved");
  });

  it("shows nothing when there is no saved figure", async () => {
    expect(await renderLoss({ wetDeltaKg: -50, savedWetDeltaKg: null })).not.toContain("When saved");
  });
});

describe("history hint", () => {
  it("says a later entry changes wet estimates, not what an earlier one measured", () => {
    expect(STOCK_HISTORY_HINT).toContain("A later entry never changes what an earlier one measured; wet estimates update.");
    expect(STOCK_HISTORY_HINT).not.toContain("never changes an earlier one");
  });
});
