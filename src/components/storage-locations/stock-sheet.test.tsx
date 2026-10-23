import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import type { ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import type { OutputStockHistoryEntry, OutputSubBin } from "@/types/output-stock";
import type { FeedstockBinStock } from "@/types/feedstock-bin-ledger";

const state = vi.hoisted(() => ({ output: [] as OutputStockHistoryEntry[], feedstock: undefined as FeedstockBinStock | undefined, removeOutputLoss: vi.fn(),
  balance: undefined as { beforeEstimatedWetKg: number | null; beforeDryKg: number; lane: "product" | "biochar" } | undefined }));
vi.mock("@/hooks/use-output-stock", () => ({ useOutputStockHistory: () => ({ data: state.output }), useOutputStockBalance: (bin: unknown) => ({ data: bin ? state.balance : undefined }),
  useRemoveOutputLoss: () => ({ mutateAsync: state.removeOutputLoss, isPending: false }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/hooks/use-bin-movements", () => ({ useFeedstockBinStock: () => ({ data: state.feedstock, dataUpdatedAt: Date.parse("2026-10-03T12:00:00Z") }) }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC" }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/ui/modal", () => ({ Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div role="dialog">{children}</div> : null }));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null, Tooltip: ({ children }: { children: ReactNode }) => children }));
vi.mock("./sub-bin-card", async (importOriginal) => ({ ...(await importOriginal<typeof import("./sub-bin-card")>()), DetailsTooltip: ({ trigger }: { trigger: ReactNode }) => trigger, SubBinTooltip: ({ trigger }: { trigger: ReactNode }) => trigger, subBinMoistureText: () => "20%" }));

import { SecondaryFigure } from "@/components/ui/secondary-figure";
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
  state.balance = { beforeEstimatedWetKg: 1100, beforeDryKg: 737, lane: "product" };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<OutputStockHistory storageLocationId={BIN_ID} facilityId={FACILITY_ID} triggerLabel="History" />); });
  await act(async () => renderer.root.findByType("button").props.onClick());
  const markup = text(renderer.root);
  // Wet mass leads, the dry biochar under it.
  expect(markup).toContain("1,100 kg wet mass");
  expect(renderer.root.findByType(SecondaryFigure).props).toMatchObject({ label: "Dry biochar", value: "737 kg" });
  // The correction is its own entry; the entry it replaced stays, struck, as Replaced.
  expect(markup).toContain("Corrected lost mass: 5 kg wet mass");
  expect(markup).toContain("Replaced");
  expect(markup).toContain("Replaces");
  expect(markup).toContain("Counted 95 kg wet mass");
  expect(markup).toContain("Switched to mix");
  expect(markup).not.toMatch(/Not available|Unknown until/);
  expect(renderer.root.findAllByType("details")).toHaveLength(4);
  // The correction and the entry it replaced link to each other.
  expect(renderer.root.findAllByType("a").map(link => link.props.href)).toEqual([stockSourceHref({ entity: "delivery", id: "delivery-id" }, FACILITY_ID),
    "#output-movement-loss", "#output-movement-fixed"]);
  // One day heading for the loss and correction, one for the following day's actions. These entries carry no wet
  // figure, so no heading shows a stock at day end (a replayed dry balance here would read below zero).
  expect(renderer.root.findAllByType("h4").map(text)).toHaveLength(2);
  expect(renderer.root.findAllByType("h4").some(node => /at day end/.test(text(node)))).toBe(false);
  await act(async () => renderer.unmount());
});

it("leads with the wet mass of a product added to the bin, with the dry biochar under it", async () => {
  state.output = [entry({ id: "product", kind: "intake", moisturePercent: 20, wetMassKg: 150, dryMassKg: -120, wetDeltaKg: 150, solidsDeltaKg: 120 })];
  state.balance = { beforeEstimatedWetKg: 150, beforeDryKg: 120, lane: "product" };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<OutputStockHistory storageLocationId={BIN_ID} facilityId={FACILITY_ID} triggerLabel="History" />); });
  await act(async () => renderer.root.findByType("button").props.onClick());
  const markup = text(renderer.root);
  expect(markup).toContain("150 kg wet mass");
  expect(markup).toContain("Added 150 kg wet mass");
  expect(markup).toMatch(/150 kg wet mass\s+at day end/);
  expect(markup).not.toContain("no moisture reading");
  expect(renderer.root.findByType(SecondaryFigure).props).toMatchObject({ label: "Dry biochar", value: "120 kg" });
  expect(renderer.root.findAllByType("a").filter(node => text(node) === "adding stock")).toHaveLength(0);
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
  // Dry solids read under the wet stock; the moisture is in the water band's details, not the caption.
  expect(renderer.root.findByType(SecondaryFigure).props).toMatchObject({ label: "Dry solids", value: "40 kg" });
  expect(text(renderer.root.findAllByType("section")[0]!)).not.toMatch(/Not available|moisture/);
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
  await act(async () => { renderer = create(<StockLevelChart points={[{ t: Date.parse(INSTANT), dryKg: 80, waterKg: 20, wetKg: 100 }]} now={Date.parse(NEXT_DAY)} timeZone="UTC" />); });
  expect(renderer.root.findByType("svg").props["aria-hidden"]).toBe("true");
  expect(renderer.root.findByType("button").props["aria-label"]).toContain("details");
  await act(async () => renderer.unmount());
});

it("leaves the water figure out of the chart key when the latest point has none", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<StockLevelChart points={[{ t: Date.parse(INSTANT), dryKg: 80, waterKg: 20, wetKg: 100 },
    { t: Date.parse(NEXT_DAY), dryKg: 55, waterKg: null, wetKg: 50 }]} now={Date.parse(NEXT_DAY)} timeZone="UTC" />); });
  const key = text(renderer.root.findByType("figcaption"));
  expect(key).toContain("Water, estimated");
  expect(key).not.toMatch(/Not recorded|Not available|0 kg$/);
  await act(async () => renderer.unmount());
});

it("offers Edit and Delete only for the latest Lost mass and explains the locked entry", async () => {
  state.output = [entry({ id: "older", editLockedReason: "Locked because newer stock entries were recorded on this bin after it." }),
    entry({ id: "latest", editLockedReason: null })];
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<OutputStockHistory storageLocationId={BIN_ID} facilityId={FACILITY_ID} triggerLabel="History" />); });
  await act(async () => renderer.root.findByType("button").props.onClick());
  expect(renderer.root.findAllByType("button").filter(button => text(button) === "Edit")).toHaveLength(1);
  expect(renderer.root.findAllByType("button").filter(button => text(button) === "Delete")).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).toContain("Locked because newer stock entries were recorded on this bin after it.");
  await act(async () => renderer.unmount());
});

it("deletes the latest output Lost mass with the shared dialog and a required reason", async () => {
  state.output = [entry({ id: "latest", editLockedReason: null })];
  state.removeOutputLoss.mockReset().mockResolvedValue({ movementId: "reversal" });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<OutputStockHistory storageLocationId={BIN_ID} facilityId={FACILITY_ID} triggerLabel="History" />); });
  await act(async () => renderer.root.findByType("button").props.onClick());
  await act(async () => renderer.root.findAllByType("button").find(button => text(button) === "Delete")!.props.onClick());
  expect(text(renderer.root.findByProps({ className: "title-heading-3 pr-40" }))).toBe("Delete lost mass");
  expect(JSON.stringify(renderer.toJSON())).toContain("goes back into the bin.");
  const confirm = () => renderer.root.findAllByType("button").filter(button => text(button) === "Delete").at(-1)!.props.onClick();
  await act(async () => confirm());
  expect(state.removeOutputLoss).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain("Enter why you delete this entry.");
  await act(async () => renderer.root.findByProps({ id: "loss-delete-reason", rows: 2 }).props.onChange({ target: { value: " Recorded twice " } }));
  await act(async () => confirm());
  expect(state.removeOutputLoss).toHaveBeenCalledWith(expect.objectContaining({ storageLocationId: BIN_ID, correctsMovementId: "latest", reason: "Recorded twice" }));
  await act(async () => renderer.unmount());
});

it("says when and by whom a deleted Lost mass was deleted", async () => {
  state.output = [entry({ id: "loss" }), entry({ id: "reverse", kind: "reversal", eventKind: "loss", correctsMovementId: "loss", dryMassKg: -8, reason: "Recorded twice",
    recordedAt: NEXT_DAY, actorName: "Asha" })];
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<OutputStockHistory storageLocationId={BIN_ID} facilityId={FACILITY_ID} triggerLabel="History" />); });
  await act(async () => renderer.root.findByType("button").props.onClick());
  const markup = text(renderer.root);
  expect(markup).toMatch(/Deleted .+ by Asha\.\s+It no longer counts toward the stock\./);
  expect(markup).toMatch(/Why deleted\s+Recorded twice/);
  expect(renderer.root.findAllByType("button").filter(button => text(button) === "Delete")).toHaveLength(0);
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
    entry({ id: 'placement-reversal', kind: 'reversal', correctsMovementId: 'product', dryMassKg: 80, recordedAt: NEXT_DAY, actorName: 'Asha' })];
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<OutputStockHistory storageLocationId={BIN_ID} facilityId={FACILITY_ID} triggerLabel="History" />); });
  await act(async () => renderer.root.findByType('button').props.onClick());
  expect(JSON.stringify(renderer.toJSON())).toContain('line-through');
  // A deleted product reads like a deleted Lost mass: when and by whom, not a bare "Reversed."
  expect(text(renderer.root)).toMatch(/Deleted Oct 2, 2026, 12:00 by Asha\.\s*It no longer counts toward the stock\./);
  expect(text(renderer.root)).not.toContain('Reversed.');
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

it("pins split product bays: fill sizes against the largest bay, water and compost bands, shared key", async () => {
  const big: OutputSubBin = { layerId: "big", code: "PR-1", placedAt: INSTANT, dryMassKg: 90, solidsKg: 160, wetEstimateKg: 200, moisturePercent: 20, basis: null, recentMovements: [], ingredients: [{ name: "Compost", solidsKg: 70 }] };
  const small: OutputSubBin = { ...big, layerId: "small", code: "PR-2", dryMassKg: 80, solidsKg: 80, wetEstimateKg: 100, ingredients: [] };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<SubBinBays subBins={[big, small]} label="Sub-bins" timeZone="UTC" />); });
  const fills = renderer.root.findAll(node => node.type === "span" && node.props["aria-hidden"] === "true" && node.props.style?.height?.endsWith("%"));
  const heights = (fill: (typeof fills)[number]) => fill.findAll(node => node.type === "span" && node.props.style?.height).map(node => node.props.style.height);
  expect(fills.map(fill => fill.props.style.height)).toEqual(["100%", "50%"]);
  expect(fills.map(heights)).toEqual([["100%", "20%", "35%"], ["50%", "20%"]]);
  const json = JSON.stringify(renderer.toJSON());
  expect(json).toContain("Ingredient solids");
  expect(json).toContain("Water, estimated");
  await act(async () => renderer.unmount());
});

it("intended: a split bay whose wet is below its solids is sized by solids and its bands stay within the bay", async () => {
  const bay: OutputSubBin = { layerId: "low", code: "PR-9", placedAt: INSTANT, dryMassKg: 50, solidsKg: 80, wetEstimateKg: 70, moisturePercent: 20, basis: null, recentMovements: [], ingredients: [{ name: "Compost", solidsKg: 30 }] };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<SubBinBays subBins={[bay]} label="Sub-bins" timeZone="UTC" capacityKg={100} />); });
  const fills = renderer.root.findAll(node => node.type === "span" && node.props["aria-hidden"] === "true" && node.props.style?.height?.endsWith("%"));
  expect(fills.map(fill => fill.props.style.height)).toEqual(["80%"]);
  const bands = fills[0].findAll(node => node.type === "span" && node.props.style?.height).map(node => node.props.style.height);
  expect(bands).toEqual(["80%", "37.5%"]);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Water, estimated");
  await act(async () => renderer.unmount());
});
