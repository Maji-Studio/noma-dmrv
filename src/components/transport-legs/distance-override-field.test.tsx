// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DistanceOverrideField } from "./distance-override-field";

afterEach(cleanup);

type FieldProps = ComponentProps<typeof DistanceOverrideField>;
type Overrides = Partial<Omit<FieldProps, "distanceRegistration" | "sourceRegistration" | "noteRegistration">>;

function Harness(props: Overrides) {
  const { register } = useForm({ defaultValues: { km: null as number | null, source: "manual", note: "" } });
  return (
    <DistanceOverrideField
      id="km"
      sourceId="source"
      noteId="note"
      hint="Where the distance comes from."
      overriding={false}
      onOverride={vi.fn()}
      onClear={vi.fn()}
      derived={{ distanceKm: 42, source: "map_estimate" }}
      locationName="Kilolo depot"
      source="manual"
      notePlaceholder="e.g., detour"
      distanceRegistration={register("km")}
      sourceRegistration={register("source")}
      noteRegistration={register("note")}
      {...props}
    />
  );
}

const distance = () => screen.getByRole("spinbutton", { name: /One-way distance/ }) as HTMLInputElement;
const OVERRIDE = "Override the one-way distance";
const RESET = "Reset to the location default";

describe("DistanceOverrideField", () => {
  it("shows a derived distance greyed and read-only, its provenance behind the ⓘ", () => {
    render(<Harness />);
    expect(distance().readOnly).toBe(true);
    expect(distance().value).toBe("42");
    expect(screen.queryByText("Location default")).toBeNull();
    // FormField renders the ⓘ text once for screen readers; the hover shows the same.
    expect(screen.getByText("From Kilolo depot. Source: Route calculation.")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /Distance source/ })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Distance note/ })).toBeNull();
  });

  it("puts the Override button beside the input, outside it", () => {
    const onOverride = vi.fn();
    render(<Harness onOverride={onOverride} />);
    const action = screen.getByRole("button", { name: OVERRIDE });
    expect(action.textContent).toBe("Override");
    expect(distance().parentElement?.contains(action)).toBe(false);
    expect(action.parentElement).toBe(distance().parentElement?.parentElement);
    expect(distance().parentElement?.textContent).toContain("km");
    fireEvent.click(action);
    expect(onOverride).toHaveBeenCalledOnce();
  });

  it("shows an override with its source and note, and Reset to default beside the input", () => {
    const onClear = vi.fn();
    render(<Harness overriding onClear={onClear} />);
    expect(distance().readOnly).toBe(false);
    expect(screen.getByText("Override. Location default is 42 km.")).toBeTruthy();
    expect(screen.queryByText("Clearing returns to the location default, 42 km.")).toBeNull();
    expect(screen.getByRole("combobox", { name: /Distance source/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /Distance note/ })).toBeTruthy();
    const reset = screen.getByRole("button", { name: RESET });
    expect(reset.textContent).toBe("Reset to default");
    expect(reset.parentElement).toBe(distance().parentElement?.parentElement);
    fireEvent.click(reset);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("moves focus to the control that replaced the pressed one", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: OVERRIDE }));
    rerender(<Harness overriding />);
    expect(document.activeElement).toBe(distance());
    fireEvent.click(screen.getByRole("button", { name: RESET }));
    rerender(<Harness />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: OVERRIDE }));
  });

  it("shows the footer under a derived distance only", () => {
    const { rerender } = render(<Harness footer={<span>Location now 55 km.</span>} />);
    expect(screen.getByText("Location now 55 km.")).toBeTruthy();
    rerender(<Harness overriding footer={<span>Location now 55 km.</span>} />);
    expect(screen.queryByText("Location now 55 km.")).toBeNull();
  });

  it("says when the location has no distance and links the fix in a new tab", () => {
    render(<Harness derived={{ distanceKm: null, source: null }} repairHref="/suppliers?supplier=s&mode=edit" />);
    expect(distance().value).toBe("");
    expect(distance().placeholder).toBe("Not recorded");
    expect(screen.queryByText(/^From /)).toBeNull();
    expect(screen.getByText(/Kilolo depot has no distance for this facility\./)).toBeTruthy();
    const link = screen.getByRole("link", { name: /Add the location distance/ });
    expect(link.getAttribute("href")).toBe("/suppliers?supplier=s&mode=edit");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("asks for the route anchor before there is a location", () => {
    render(<Harness derived={{ distanceKm: null, source: null }} locationName={null} awaitingMessage="Select a supplier to load its location distance." />);
    expect(screen.getByText("Select a supplier to load its location distance.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("claims nothing while the saved distance loads", () => {
    render(<Harness pending derived={{ distanceKm: null, source: null }} />);
    expect(distance().placeholder).toBe("");
    expect(screen.queryByText(/has no distance/)).toBeNull();
  });

  it("shows the distance error only while overriding", () => {
    const { rerender } = render(<Harness errors={{ distanceKm: "Enter a distance, or reset the override." }} />);
    expect(screen.queryByText("Enter a distance, or reset the override.")).toBeNull();
    rerender(<Harness overriding errors={{ distanceKm: "Enter a distance, or reset the override." }} />);
    expect(screen.getByText("Enter a distance, or reset the override.")).toBeTruthy();
  });
});
