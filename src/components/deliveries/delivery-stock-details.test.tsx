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
it("hides the readout and single history affordance in Simple, preserves its draft and uses corrected saved quantities", async () => {
  const original: OutputStockHistoryEntry = { id: "original", deliveryId: "delivery", kind: "delivery", physicalDate: "2026-09-22", recordedAt: "2026-09-22", actorName: null, reason: "Recorded", correctsMovementId: null, wetMassKg: 100, moisturePercent: 20, dryMassKg: 80, beforeDryKg: 200, afterDryKg: 120, allocations: [] };
  history.data = [original, { ...original, id: "reversal", kind: "reversal", correctsMovementId: original.id }, { ...original, id: "replacement", correctsMovementId: original.id, wetMassKg: 90, dryMassKg: 72, allocations: [{ layerId: "batch", code: "B-001", wetMassKg: null, dryMassKg: 72, runs: [] }] }];
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FormDetailProvider scope="delivery"><FormDetailControl /><DeliveryStockDetails deliveryId="delivery" storageLocationId="bin" facilityId="facility" wetMassKg={100} dryMassKg={80} /></FormDetailProvider>); });
  expect(visible(renderer.root)).not.toContain("recorded wet");
  expect(visible(renderer.root)).not.toContain("Stock history");
  expect(visible(renderer.root)).not.toContain("Details");
  const select = async (value: string) => act(async () => renderer.root.findAllByType("input").find(node => node.props.value === value)!.props.onChange());
  await select("detailed");
  expect(visible(renderer.root)).toContain("90 kg");
  expect(visible(renderer.root)).toContain("72 kg");
  expect(visible(renderer.root)).not.toContain("100 kg");
  // This entry names no source run, so the card offers no calculation to
  // disclose and the history affordance sits in the body as a quiet action.
  expect(renderer.root.findAllByType("button").filter(node => node.props["aria-controls"])).toHaveLength(0);
  const historyButtons = renderer.root.findAllByType("button").filter(node => node.children.includes("Stock history"));
  expect(historyButtons).toHaveLength(1);
  await act(async () => historyButtons[0].props.onClick());
  await select("simple");
  expect(visible(renderer.root)).not.toContain("Correction draft");
  await select("detailed");
  expect(visible(renderer.root)).toContain("Correction draft");
  await act(async () => renderer.unmount());
});
