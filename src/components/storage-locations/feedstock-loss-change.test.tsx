import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeedstockLossChange } from "./feedstock-loss-change";

const render = (props: Partial<Parameters<typeof FeedstockLossChange>[0]>) =>
  renderToStaticMarkup(<FeedstockLossChange beforeKg={1000} moisturePercent={20} lossKg={250} blocked={false} {...props} />);

describe("FeedstockLossChange", () => {
  it("shows wet stock before and after the loss", () => {
    const markup = render({});
    expect(markup).toContain("1,000 kg");
    expect(markup).toContain("750 kg");
    expect(markup).toContain("Wet stock, 20% moisture");
  });

  it("leaves the moisture clause out when moisture is unknown", () => {
    const markup = render({ moisturePercent: null });
    expect(markup).not.toContain("oisture");
    expect(markup).not.toContain("Not recorded");
  });

  it("waits for a usable mass", () => {
    expect(render({ lossKg: null })).toContain("Enter a mass");
    expect(render({ blocked: true })).toContain("Enter a mass");
  });
});
