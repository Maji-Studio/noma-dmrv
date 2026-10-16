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

describe("DistanceOverrideField", () => {
  it("shows a derived distance greyed, read-only and with its provenance", () => {
    render(<Harness />);
    expect(distance().readOnly).toBe(true);
    expect(distance().value).toBe("42");
    expect(screen.getByText("Location default")).toBeTruthy();
    expect(screen.getByText("From Kilolo depot. Source: Route calculation.")).toBeTruthy();
    expect(distance().getAttribute("aria-describedby")).toContain("km-basis");
    expect(screen.queryByRole("combobox", { name: /Distance source/ })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Distance note/ })).toBeNull();
  });

  it("unlocks manual entry from the Override button", () => {
    const onOverride = vi.fn();
    render(<Harness onOverride={onOverride} />);
    fireEvent.click(screen.getByRole("button", { name: "Override" }));
    expect(onOverride).toHaveBeenCalledOnce();
  });

  it("shows an override as manual, with its source and note, and what clearing returns to", () => {
    const onClear = vi.fn();
    render(<Harness overriding onClear={onClear} />);
    expect(distance().readOnly).toBe(false);
    expect(screen.getByText("Override")).toBeTruthy();
    expect(screen.queryByText("Location default")).toBeNull();
    expect(screen.getByText("Clearing returns to the location default, 42 km.")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Distance source/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /Distance note/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear override" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("moves focus to the control that replaced the pressed button", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Override" }));
    rerender(<Harness overriding />);
    expect(document.activeElement).toBe(distance());
    fireEvent.click(screen.getByRole("button", { name: "Clear override" }));
    rerender(<Harness />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Override" }));
  });

  it("says when the location has no distance and links the fix in a new tab", () => {
    render(<Harness derived={{ distanceKm: null, source: null }} repairHref="/suppliers?supplier=s&mode=edit" />);
    expect(distance().value).toBe("");
    expect(distance().placeholder).toBe("Not recorded");
    expect(screen.queryByText("Location default")).toBeNull();
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
    const { rerender } = render(<Harness errors={{ distanceKm: "Enter a distance, or clear the override." }} />);
    expect(screen.queryByText("Enter a distance, or clear the override.")).toBeNull();
    rerender(<Harness overriding errors={{ distanceKm: "Enter a distance, or clear the override." }} />);
    expect(screen.getByText("Enter a distance, or clear the override.")).toBeTruthy();
  });
});
