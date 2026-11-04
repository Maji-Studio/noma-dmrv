// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OutputStockHistoryEntry } from "@/types/output-stock";

const history = vi.hoisted(() => ({ data: [] as OutputStockHistoryEntry[] }));
vi.mock("@/hooks/use-output-stock", () => ({
  useOutputStockBalance: () => ({ data: undefined }), useOutputStockHistory: () => ({ data: history.data }) }));
import { DeliveryStockDetails } from "./delivery-stock-details";

afterEach(cleanup);
const OPEN_INFO = { name: "About Delivery stock" };

it("shows the bar and the corrected wet mass inline, and puts the ledger behind the (i)", async () => {
  const original: OutputStockHistoryEntry = { id: "original", deliveryId: "delivery", kind: "delivery", occurredAt: "2026-09-22T12:00:00.000Z", recordedAt: "2026-09-22", actorName: null, reason: "Recorded", correctsMovementId: null, wetMassKg: 100, moisturePercent: 20, dryMassKg: 80, beforeDryKg: 200, afterDryKg: 120, allocations: [] };
  history.data = [original, { ...original, id: "reversal", kind: "reversal", correctsMovementId: original.id }, { ...original, id: "replacement", correctsMovementId: original.id, wetMassKg: 90, dryMassKg: 72, allocations: [{ layerId: "batch", code: "B-001", wetMassKg: null, dryMassKg: 72, runs: [] }] }];
  const { container } = render(<DeliveryStockDetails deliveryId="delivery" storageLocationId="bin" wetMassKg={100} dryMassKg={80} />);
  const inline = container.textContent ?? "";
  expect(inline).toContain("B-001");
  expect(inline).toContain("72 kg");
  expect(inline).toContain("Wet mass");
  expect(inline).toContain("90 kg");
  expect(inline).not.toContain("100 kg");
  expect(inline).not.toContain("% of total");
  expect(screen.queryByText("Show calculation")).toBeNull();
  // Stock history lives on the storage bin, not on this card.
  expect(inline).not.toContain("Stock history");

  fireEvent.click(screen.getByRole("button", OPEN_INFO));
  expect(await screen.findByText("% of total")).toBeTruthy();
  // This entry names no source run, so the panel holds the ledger only.
  expect(screen.queryByLabelText("Source production runs per delivered batch")).toBeNull();
});

it("opens the production runs behind each delivered batch in the same panel", async () => {
  const entry: OutputStockHistoryEntry = { id: "entry", deliveryId: "delivery", kind: "delivery", occurredAt: "2026-09-22T12:00:00.000Z", recordedAt: "2026-09-22", actorName: null, reason: "Recorded", correctsMovementId: null, wetMassKg: 100, moisturePercent: 20, dryMassKg: 80, beforeDryKg: 200, afterDryKg: 120, allocations: [{ layerId: "batch", code: "B-001", wetMassKg: null, dryMassKg: 80, runs: [{ productionRunId: "run-a", code: "PR-26-001", dryMassKg: 50 }, { productionRunId: "run-b", code: "PR-26-002", dryMassKg: 30 }] }] };
  history.data = [entry];
  const { container } = render(<DeliveryStockDetails deliveryId="delivery" storageLocationId="bin" wetMassKg={100} dryMassKg={80} />);
  expect(container.textContent).not.toContain("PR-26-001");
  fireEvent.click(screen.getByRole("button", OPEN_INFO));
  const runs = await screen.findByLabelText("Source production runs per delivered batch");
  expect(within(runs).getByText(/PR-26-001/)).toBeTruthy();
  expect(within(runs).getByText(/PR-26-002/)).toBeTruthy();
  expect(within(runs).getByText(/B-001/)).toBeTruthy();
});
