import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { transportLegFormSchema } from "@/schemas/transport-legs";
import { TransportLegForm } from "./transport-leg-form";

const captured = vi.hoisted(() => ({ allowEstimate: undefined as boolean | undefined }));

vi.mock("@/components/forms", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms")>(),
  PositionPicker: () => null,
  DistanceCalcField: (props: { allowEstimate?: boolean }) => { captured.allowEstimate = props.allowEstimate; return null; },
}));

it("exposes model year as an editable optional input", () => {
  const leg = transportLegFormSchema.parse({ distanceKm: 10, loadMassKg: 100, modelYear: 2020 });
  const html = renderToStaticMarkup(<TransportLegForm leg={leg} onSubmit={vi.fn()} onCancel={vi.fn()} />);
  expect(html).toContain('for="modelYear"');
  const input = html.match(/<input[^>]*id="modelYear"[^>]*>/)?.[0];
  expect(input).toContain('type="number"');
  expect(input).toContain('name="modelYear"');
  expect(input).not.toContain("required");
  expect(input).toContain('min="1900"');
  expect(input).toContain(`max="${new Date().getFullYear() + 1}"`);
  expect(input).toContain('step="1"');
  expect(transportLegFormSchema.parse({ distanceKm: 10, loadMassKg: 100, modelYear: "" }).modelYear).toBeNull();
});

it("disables GPS estimation on the per-leg form", () => {
  renderToStaticMarkup(<TransportLegForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
  expect(captured.allowEstimate).toBe(false);
});
