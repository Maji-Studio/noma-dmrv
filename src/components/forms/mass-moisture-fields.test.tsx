import { renderToStaticMarkup } from "react-dom/server";
import { useEffect, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

const splitMounts = vi.hoisted(() => ({ count: 0 }));

vi.mock("./form-field", () => ({
  FormField: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./form-input", () => ({
  FormInput: ({ id }: { id: string }) => <input id={id} />,
}));

vi.mock("@/components/ui/moisture-split", () => ({
  MoistureSplit: ({ addedWaterKg }: { addedWaterKg?: number | null }) => {
    useEffect(() => { splitMounts.count += 1; }, []);
    return <div data-testid="captured-split">Added water: {addedWaterKg}</div>;
  },
}));

import { FormDetailProvider } from "./form-detail-context";
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

  it("gives the split no frame of its own and keeps it visible in Simple", () => {
    const html = renderToStaticMarkup(
      <FormDetailProvider scope="feedstock">
        <MassMoistureFields
          wetMassKg={4000}
          moisturePercent={20}
          wet={{ id: "massKg", registration: registration("massKg") }}
          moisture={{
            id: "moistureContentPercent",
            registration: registration("moistureContentPercent"),
          }}
        />
      </FormDetailProvider>,
    );

    // Variant E: the bar sits directly under the inputs, with no card, frame or
    // tinted panel, and Simple never hides it.
    expect(html).toContain(
      '<div data-testid="mass-moisture-split" class="md:col-span-2 [&amp;:not(:has(*:not(:empty)))]:hidden">',
    );
    expect(html).not.toContain("border-l-2");
    expect(html).not.toContain("--color-background-medium");
    expect(html).not.toContain('hidden=""');
    expect(html).toContain('data-testid="captured-split"');
  });

  it("keeps the split mounted when the first input arrives", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const fields = (wetMassKg: unknown) => (
      <MassMoistureFields
        wetMassKg={wetMassKg}
        moisturePercent={null}
        wet={{ id: "massKg", registration: registration("massKg") }}
        moisture={{ id: "moistureContentPercent", registration: registration("moistureContentPercent") }}
      />
    );
    splitMounts.count = 0;
    let renderer!: ReactTestRenderer;
    // Outside a provider the level is Detailed, so the untouched split renders
    // as explanation; the first value turns it into data in the same place.
    await act(async () => { renderer = create(fields(null)); });
    await act(async () => renderer.update(fields(100)));
    await act(async () => renderer.update(fields(null)));
    expect(splitMounts.count).toBe(1);
    await act(async () => renderer.unmount());
  });
});
