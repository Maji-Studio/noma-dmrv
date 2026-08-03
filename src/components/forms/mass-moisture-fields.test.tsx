import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./form-field", () => ({
  FormField: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./form-input", () => ({
  FormInput: ({ id }: { id: string }) => <input id={id} />,
}));

vi.mock("@/components/ui/moisture-split", () => ({
  MoistureSplit: ({ addedWaterKg }: { addedWaterKg?: number | null }) => (
    <div data-testid="captured-split">Added water: {addedWaterKg}</div>
  ),
}));

import { MassMoistureFields } from "./mass-moisture-fields";

const registration = (name: string) => ({
  name,
  onBlur: async () => undefined,
  onChange: async () => undefined,
  ref: () => undefined,
});

describe("MassMoistureFields", () => {
  it("renders supporting controls before the chart and passes added water through", () => {
    const html = renderToStaticMarkup(
      <MassMoistureFields
        wetMassKg={450}
        moisturePercent={10}
        addedWaterKg={50}
        addedWaterField={<div data-testid="added-water-field">Water added</div>}
        wet={{
          id: "massKg",
          registration: registration("massKg"),
        }}
        moisture={{
          id: "moistureContentPercent",
          registration: registration("moistureContentPercent"),
        }}
      />,
    );

    expect(html.indexOf('data-testid="added-water-field"')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('data-testid="mass-moisture-split"')).toBeGreaterThan(
      html.indexOf('data-testid="added-water-field"'),
    );
    expect(html).toContain(
      'class="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-16"',
    );
    expect(html).not.toContain("sm:grid-cols-2");
    expect(html).toContain("Added water: 50");
  });
});
