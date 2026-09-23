import { useState } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, expect, it, vi } from "vitest";
import { FormDetailControl, FormDetailProvider } from "@/components/forms/form-detail-context";
import type { OutputStockHistoryEntry } from "@/types/output-stock";

// The title's InfoHint is a Base UI tooltip, which needs a DOM this node
// environment does not have; the hint's copy is not what this test asserts.
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));

const history = vi.hoisted(() => ({ data: [] as OutputStockHistoryEntry[] }));
vi.mock("@/hooks/use-output-stock", () => ({ useOutputStockHistory: () => ({ data: history.data }) }));
vi.mock("@/components/storage-locations/output-stock-history", () => ({ OutputStockHistory: function History() {
  const [draft, setDraft] = useState(false);
  return <button type="button" onClick={() => setDraft(true)}>{draft ? "Correction draft" : "Stock history"}</button>;
} }));
import { DeliveryStockDetails } from "./delivery-stock-details";

function visible(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visible).join(" ");
}
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
it("keeps the bar and its history action in Simple, adds the figures in Detailed, and uses corrected saved quantities", async () => {
  const original: OutputStockHistoryEntry = { id: "original", deliveryId: "delivery", kind: "delivery", physicalDate: "2026-09-22", recordedAt: "2026-09-22", actorName: null, reason: "Recorded", correctsMovementId: null, wetMassKg: 100, moisturePercent: 20, dryMassKg: 80, beforeDryKg: 200, afterDryKg: 120, allocations: [] };
  history.data = [original, { ...original, id: "reversal", kind: "reversal", correctsMovementId: original.id }, { ...original, id: "replacement", correctsMovementId: original.id, wetMassKg: 90, dryMassKg: 72, allocations: [{ layerId: "batch", code: "B-001", wetMassKg: null, dryMassKg: 72, runs: [] }] }];
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FormDetailProvider scope="delivery"><FormDetailControl /><DeliveryStockDetails deliveryId="delivery" storageLocationId="bin" facilityId="facility" wetMassKg={100} dryMassKg={80} /></FormDetailProvider>); });
  // Simple is the bar and its key line: the batch drawn and its dry mass, plus
  // the one action the block offers. The wet figure and the ledger are Detailed.
  const simple = visible(renderer.root);
  expect(simple).toContain("B-001");
  expect(simple).toContain("72 kg");
  expect(simple).not.toContain("Wet mass");
  expect(simple).not.toContain("Dry biochar");
  const select = async (value: string) => act(async () => renderer.root.findAllByType("input").find(node => node.props.value === value)!.props.onChange());
  await select("detailed");
  expect(visible(renderer.root)).toContain("90 kg");
  expect(visible(renderer.root)).toContain("72 kg");
  expect(visible(renderer.root)).not.toContain("100 kg");
  // This entry names no source run, so the card offers no calculation to
  // disclose and the action row carries the history affordance alone.
  expect(renderer.root.findAllByType("button").filter(node => node.props["aria-controls"])).toHaveLength(0);
  const historyButtons = renderer.root.findAllByType("button").filter(node => node.children.includes("Stock history"));
  expect(historyButtons).toHaveLength(1);
  // The history dialog stays mounted across a toggle, so a half-written
  // correction is not thrown away by changing how much detail is on screen.
  await act(async () => historyButtons[0].props.onClick());
  await select("simple");
  await select("detailed");
  expect(visible(renderer.root)).toContain("Correction draft");
  await act(async () => renderer.unmount());
});

it("discloses the production runs behind each delivered batch and nothing else", async () => {
  const entry: OutputStockHistoryEntry = { id: "entry", deliveryId: "delivery", kind: "delivery", physicalDate: "2026-09-22", recordedAt: "2026-09-22", actorName: null, reason: "Recorded", correctsMovementId: null, wetMassKg: 100, moisturePercent: 20, dryMassKg: 80, beforeDryKg: 200, afterDryKg: 120, allocations: [{ layerId: "batch", code: "B-001", wetMassKg: null, dryMassKg: 80, runs: [{ productionRunId: "run-a", code: "PR-26-001", dryMassKg: 50 }, { productionRunId: "run-b", code: "PR-26-002", dryMassKg: 30 }] }] };
  history.data = [entry];
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FormDetailProvider scope="delivery"><FormDetailControl /><DeliveryStockDetails deliveryId="delivery" storageLocationId="bin" facilityId="facility" wetMassKg={100} dryMassKg={80} /></FormDetailProvider>); });
  await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
  const disclosure = renderer.root.findAllByType("button").find(node => node.props["aria-controls"])!;
  await act(async () => disclosure.props.onClick());
  const runs = renderer.root.findByProps({ "aria-label": "Source production runs per delivered batch" });
  expect(visible(runs)).toContain("PR-26-001");
  expect(visible(runs)).toContain("PR-26-002");
  // Runs only. The batch code is a lead-in naming whose runs these are; the
  // ledger above already totals the batch, so its 80 kg is never repeated here.
  expect(visible(runs)).toContain("B-001");
  expect(visible(runs)).not.toContain("80 kg");
  await act(async () => renderer.unmount());
});
