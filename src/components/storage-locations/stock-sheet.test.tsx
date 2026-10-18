import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import type { ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import type { OutputStockHistoryEntry, OutputSubBin } from "@/types/output-stock";
import type { FeedstockBinStock } from "@/types/feedstock-bin-ledger";

const state = vi.hoisted(() => ({ output: [] as OutputStockHistoryEntry[], feedstock: undefined as FeedstockBinStock | undefined }));
vi.mock("@/hooks/use-output-stock", () => ({ useOutputStockHistory: () => ({ data: state.output }) }));
vi.mock("@/hooks/use-bin-movements", () => ({ useFeedstockBinStock: () => ({ data: state.feedstock, dataUpdatedAt: Date.parse("2026-10-03T12:00:00Z") }) }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC" }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/ui/modal", () => ({ Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div role="dialog">{children}</div> : null }));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null, Tooltip: ({ children }: { children: ReactNode }) => children }));
vi.mock("./sub-bin-card", () => ({ DetailsTooltip: ({ trigger }: { trigger: ReactNode }) => trigger, SubBinTooltip: ({ trigger }: { trigger: ReactNode }) => trigger, subBinMoistureText: () => "20%" }));

import { FeedstockBinBalance } from "./feedstock-bin-balance";
import { OutputStockHistory } from "./output-stock-history";
import { StockLevelChart } from "./stock-level-chart";
import { stockSourceHref } from "./stock-source-link";
import { SubBinBays } from "./sub-bin-bays";

const INSTANT = "2026-10-01T12:00:00.000Z";
const NEXT_DAY = "2026-10-02T12:00:00.000Z";
const BIN_ID = "00000000-0000-4000-8000-000000000001";
const FACILITY_ID = "00000000-0000-4000-8000-000000000002";
function entry(values: Partial<OutputStockHistoryEntry>): OutputStockHistoryEntry {
  return { id: "loss", kind: "loss", occurredAt: INSTANT, recordedAt: INSTANT, actorName: null, reason: "Spilled", wetMassKg: 10,
    moisturePercent: 20, dryMassKg: 8, beforeDryKg: 80, afterDryKg: 72, correctsMovementId: null, deliveryId: null, allocations: [], ...values };
}
function text(node: ReactTestInstance | string): string { return typeof node === "string" ? node : node.children.map(text).join(" "); }
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

it("keeps old counts and corrections readable, folds reversals, groups days and links the originating record", async () => {
  state.output = [entry({}), entry({ id: "reverse", kind: "reversal", correctsMovementId: "loss", dryMassKg: -8 }),
    entry({ id: "fixed", kind: "replacement", eventKind: "loss", correctsMovementId: "loss", wetMassKg: 5, dryMassKg: 4, afterDryKg: 76 }),
    entry({ id: "count", kind: "count", occurredAt: NEXT_DAY, wetMassKg: 95, reason: "Old count" }),
    entry({ id: "delivery", kind: "delivery", occurredAt: NEXT_DAY, source: { entity: "delivery", id: "delivery-id" } }),
    entry({ id: "mix", kind: "merge", occurredAt: NEXT_DAY })];
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<OutputStockHistory storageLocationId={BIN_ID} facilityId={FACILITY_ID} triggerLabel="History" />); });
  await act(async () => renderer.root.findByType("button").props.onClick());
  const markup = JSON.stringify(renderer.toJSON());
  expect(markup).toContain("Original");
  expect(markup).toContain("Corrected");
  expect(renderer.root.findAllByType("svg").filter(node => node.props["aria-label"] === "to")).toHaveLength(5);
  expect(markup).toContain("Stock count");
  expect(markup).toContain("Switched to mix");
  expect(markup).not.toContain("Correct entry");
  expect(renderer.root.findAllByType("details")).toHaveLength(4);
  expect(renderer.root.findAllByType("a").map(link => link.props.href)).toEqual([stockSourceHref({ entity: "delivery", id: "delivery-id" }, FACILITY_ID)]);
  // One day heading for the loss and correction, one for the following day's actions.
  expect(renderer.root.findAllByType("div").filter(node => node.props.className?.includes("pb-4 pt-12"))).toHaveLength(2);
  await act(async () => renderer.unmount());
});

it("uses the same feedstock cards, links intake/run/product history and leaves loss/count entries without links", async () => {
  const kinds = ["intake", "run_draw", "ingredient_draw", "loss", "count"] as const;
  state.feedstock = { currentWetKg: 50, batches: [{ id: "intake-id", code: "FS-001", receivedAt: INSTANT, wetKg: 50, intakeWetKg: 100, dryKg: 40, moisturePercent: 20 }],
    entries: kinds.map((kind, index) => ({ id: `${kind}-row`, sourceId: index < 3 ? `${kind}-id` : null, kind, occurredAt: INSTANT, recordedAt: INSTANT, actorName: null,
      code: null, reason: "", wetDeltaKg: index === 0 ? 100 : -10, beforeWetKg: 100, afterWetKg: 50, estimatedDryKg: 40, countedWetKg: kind === "count" ? 50 : null, moisturePercent: 20 })) };
  const adjust = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FeedstockBinBalance storageLocationId={BIN_ID} facilityId={FACILITY_ID} capacityKg={100} onAdjust={adjust} />); });
  expect(renderer.root.findAllByType("section").map(section => section.props["aria-label"])).toEqual(["Stock", "Stock over time"]);
  const actions = renderer.root.findAllByType("button");
  await act(async () => actions.find(button => text(button).includes("Adjust stock"))!.props.onClick());
  expect(adjust).toHaveBeenCalledOnce();
  await act(async () => actions.find(button => text(button).includes("History"))!.props.onClick());
  expect(renderer.root.findAllByType("a").map(link => link.props.href)).toEqual([
    stockSourceHref({ entity: "biocharProduct", id: "ingredient_draw-id" }, FACILITY_ID),
    stockSourceHref({ entity: "productionRun", id: "run_draw-id" }, FACILITY_ID),
    stockSourceHref({ entity: "feedstock", id: "intake-id" }, FACILITY_ID),
  ]);
  expect(renderer.root.findAllByType("details")).toHaveLength(5);
  await act(async () => renderer.unmount());
});

it("wraps every split bay and fills a lone bay against capacity", async () => {
  const subBin: OutputSubBin = { layerId: "layer", code: "PR-001", placedAt: INSTANT, dryMassKg: 80, solidsKg: 80, wetEstimateKg: 100, moisturePercent: 20, basis: null, recentMovements: [], ingredients: [] };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<SubBinBays subBins={[subBin]} capacityKg={200} label="Sub-bins" timeZone="UTC" />); });
  expect(renderer.root.findAllByType("span").some(node => node.props.style?.height === "50%" && node.props["aria-hidden"] === "true")).toBe(true);
  const subBins = Array.from({ length: 8 }, (_, index) => ({ ...subBin, layerId: `layer-${index}`, code: `PR-${index}` }));
  await act(async () => renderer.update(<SubBinBays subBins={subBins} label="Sub-bins" timeZone="UTC" />));
  expect(renderer.root.findAllByType("button")).toHaveLength(8);
  expect(renderer.root.findByProps({ "aria-label": "Sub-bins" }).props.className).toContain("flex-wrap");
  expect(JSON.stringify(renderer.toJSON()).match(/Next out/g)).toHaveLength(1);
  await act(async () => renderer.unmount());
});

it("exposes chart details through labelled HTML buttons while the drawing is decorative", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<StockLevelChart points={[{ t: Date.parse(INSTANT), dryKg: 80, waterKg: 20 }]} now={Date.parse(NEXT_DAY)} timeZone="UTC" />); });
  expect(renderer.root.findByType("svg").props["aria-hidden"]).toBe("true");
  expect(renderer.root.findByType("button").props["aria-label"]).toContain("details");
  await act(async () => renderer.unmount());
});

it("offers Edit only for the latest Lost mass and explains the locked entry", async () => {
  state.output = [entry({ id: "older", editLockedReason: "Locked because newer stock entries were recorded on this bin after it." }),
    entry({ id: "latest", editLockedReason: null })];
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<OutputStockHistory storageLocationId={BIN_ID} facilityId={FACILITY_ID} triggerLabel="History" />); });
  await act(async () => renderer.root.findByType("button").props.onClick());
  expect(renderer.root.findAllByType("button").filter(button => text(button) === "Edit")).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).toContain("Locked because newer stock entries were recorded on this bin after it.");
  await act(async () => renderer.unmount());
});

it("charts feedstock after its first intake when a run was dated earlier without claiming missing intake mass", async () => {
  const base = { recordedAt: INSTANT, actorName: null, code: null, reason: "", countedWetKg: null, moisturePercent: null, sourceId: null };
  state.feedstock = { currentWetKg: 40, batches: [], entries: [
    { ...base, id: "early", kind: "run_draw", occurredAt: INSTANT, wetDeltaKg: -60, beforeWetKg: 0, afterWetKg: -60, estimatedDryKg: null },
    { ...base, id: "intake", kind: "intake", occurredAt: NEXT_DAY, wetDeltaKg: 100, beforeWetKg: -60, afterWetKg: 40, estimatedDryKg: 32 },
  ] };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FeedstockBinBalance storageLocationId={BIN_ID} facilityId={FACILITY_ID} capacityKg={100} />); });
  expect(renderer.root.findAllByType(StockLevelChart)).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("An intake is missing its mass basis");
  await act(async () => renderer.unmount());
});


it('crosses out a deleted product placement while retaining the product link', async () => {
  state.output = [entry({ id: 'product', kind: 'intake', dryMassKg: -80, source: { entity: 'biocharProduct', id: 'product' } }),
    entry({ id: 'placement-reversal', kind: 'reversal', correctsMovementId: 'product', dryMassKg: 80 })];
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<OutputStockHistory storageLocationId={BIN_ID} facilityId={FACILITY_ID} triggerLabel="History" />); });
  await act(async () => renderer.root.findByType('button').props.onClick());
  expect(JSON.stringify(renderer.toJSON())).toContain('line-through');
  expect(renderer.root.findAllByType('a').map(link => link.props.href)).toContain(stockSourceHref({ entity: 'biocharProduct', id: 'product' }, FACILITY_ID));
  await act(async () => renderer.unmount());
});

it("names a lone product bay's parts like the product composition, by ingredient", async () => {
  const subBin: OutputSubBin = { layerId: "layer", code: "BP-001", placedAt: INSTANT, dryMassKg: 90, solidsKg: 160, wetEstimateKg: 200, moisturePercent: 20, basis: null, recentMovements: [],
    ingredients: [{ name: "Compost", solidsKg: 40 }, { name: "Clay", solidsKg: 30 }] };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<SubBinBays subBins={[subBin]} label="Sub-bins" timeZone="UTC" />); });
  const parts = renderer.root.findByProps({ "aria-label": "BP-001 contents" }).findAllByType("dt").map(node => node.findAllByType("span").at(-1)!.children.join(""));
  expect(parts).toEqual(["Water, estimated", "Compost solids", "Clay solids", "Dry biochar"]);
  expect(JSON.stringify(renderer.toJSON())).not.toMatch(/Solids|Ingredients, dry|Biochar, dry/);
  await act(async () => renderer.unmount());
});

