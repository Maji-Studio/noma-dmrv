import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatMassKg } from "@/lib/format-utils";
import { RecordFigure } from "./records-panel";
import type { WaterfallItem, WaterfallRecord } from "./waterfall-model";

const END = { kind: "end" } as WaterfallItem;

function figure(record: Partial<WaterfallRecord>) {
  const base = { id: "a", kind: "application", code: "AP-1", name: null, massKg: null } as WaterfallRecord;
  return renderToStaticMarkup(<RecordFigure item={END} record={{ ...base, ...record }} />);
}

describe("RecordFigure for an application", () => {
  it("labels wet and dry", () => {
    const html = figure({ wetKg: 320, massKg: 144 });
    expect(html).toContain("320 kg wet");
    expect(html).toContain("144 kg dry");
  });

  it("names the dry mass that is missing instead of hiding it", () => {
    const html = figure({ wetKg: 320, massKg: null });
    expect(html).toContain("320 kg wet");
    expect(html).toContain(`${formatMassKg(null)} (dry)`);
  });
});
