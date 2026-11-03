import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { type ReactNode } from "react";
import { useForm, type Control, type FieldValues } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ moisture: 100 / 15 as number | null }));
const entityById = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-entities", () => ({ useEntityById: (...args: unknown[]) => { entityById(...args); return { data: { mass: { moisturePercent: state.moisture } } }; } }));
vi.mock("@/components/forms", () => ({
  FormField: ({ children, cue, warning, hint }: { children: ReactNode; cue?: string; warning?: string; hint?: ReactNode }) => <div><span data-part="cue">{cue}</span><span data-part="warning">{warning}</span><span data-part="hint">{hint}</span>{children}</div>,
  FormInput: "input",
}));
import { IngredientMoistureField } from "./ingredient-moisture-field";

function Harness({ frozen = false, saved = false, massKg = 100, productId }: { frozen?: boolean; saved?: boolean; massKg?: number | null; productId?: string }) {
  const form = useForm({ defaultValues: { placedAt: "2026-10-01T08:00:00.000Z", ingredientBins: [{ storageLocationId: "bin", massKg, moistureContentPercent: saved ? 12 : null }] } });
  return <><IngredientMoistureField control={form.control as unknown as Control<FieldValues>} index={0} frozen={frozen} disabled={false} productId={productId} /><button onClick={() => form.getValues()}>Read</button></>;
}

const part = (renderer: ReactTestRenderer, name: string) => renderer.root.find(node => node.props["data-part"] === name).props.children;

describe("IngredientMoistureField", () => {
  it("starts empty, shows the bin estimate as a hint and keeps what the operator measured", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness />); });
    expect(renderer.root.findByType("input").props.value).toBe("");
    expect(part(renderer, "cue")).toBe("Estimated moisture: 6.7%");
    expect(part(renderer, "warning")).toBeUndefined();
    await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "18" } }));
    expect(part(renderer, "warning")).toBe("18% is 11.3 points above the 6.7% estimate. Check the reading before you save.");
    state.moisture = 5;
    await act(async () => renderer.update(<Harness />));
    const values = renderer.root.findByType("button").props.onClick();
    expect(values.ingredientBins[0].moistureContentPercent).toBe(18);
    await act(async () => renderer.unmount());
    state.moisture = 100 / 15;
  });
  it("asks the server for the estimate of the entered draw, leaving out the edited product", async () => {
    entityById.mockClear();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness massKg={30} productId="prod-1" />); });
    expect(entityById).toHaveBeenLastCalledWith("storageLocation", "bin", { occurredAt: "2026-10-01T08:00:00.000Z", drawWetKg: "30", excludeProductId: "prod-1" });
    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(<Harness massKg={null} productId="prod-1" />); });
    expect(entityById).toHaveBeenLastCalledWith("storageLocation", "bin", { occurredAt: "2026-10-01T08:00:00.000Z" });
    await act(async () => renderer.unmount());
  });
  it("keeps a saved frozen measurement", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness saved frozen />); });
    const input = renderer.root.findByType("input");
    expect(input.props.value).toBe(12);
    expect(input.props.disabled).toBe(true);
    await act(async () => renderer.unmount());
  });
});
