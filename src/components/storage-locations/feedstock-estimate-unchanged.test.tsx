import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { estimateKg } from "./output-stock-history-days";
import { StockLevelChart } from "./stock-level-chart";
import { MixPileBay, type PileBand } from "./sub-bin-bays";

const water = (estimated?: boolean): PileBand => ({ label: "Water, estimated", kg: 5.3, category: "existing-water", estimated, details: [] });
const points = [{ t: 0, dryKg: 0, waterKg: 0, wetKg: 0 }, { t: 1000, dryKg: 69.7, waterKg: 5.3, wetKg: 75.4 }];
const chart = (formatEstimate?: (kg: number) => string) => renderToStaticMarkup(
  <StockLevelChart points={points} timeZone="UTC" now={2000} formatEstimate={formatEstimate} />,
);

it("keeps a feedstock bin's pile list and chart legend at one decimal", () => {
  expect(renderToStaticMarkup(<MixPileBay bands={[water()]} />)).toContain("5.3 kg");
  expect(chart()).toContain("Water, estimated 5.3 kg");
});

it("reads an output bin's estimated water in whole kg when it opts in", () => {
  expect(renderToStaticMarkup(<MixPileBay bands={[water(true)]} />)).toContain("5 kg");
  expect(renderToStaticMarkup(<MixPileBay bands={[water(true)]} />)).not.toContain("5.3 kg");
  expect(chart(estimateKg)).toContain("Water, estimated 5 kg");
});
