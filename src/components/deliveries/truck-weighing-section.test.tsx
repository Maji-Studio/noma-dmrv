import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UseFormRegisterReturn } from "react-hook-form";
import {
  deriveWeighbridgeWetMass,
  TruckWeighingSection,
} from "./truck-weighing-section";

function registration(name: string): UseFormRegisterReturn {
  return {
    name,
    onBlur: vi.fn(),
    onChange: vi.fn(),
    ref: vi.fn(),
  };
}

function render(wetMassKg: number) {
  return renderToStaticMarkup(
    <TruckWeighingSection
      arrivalMassKg={15_000}
      departureMassKg={5_000}
      wetMassKg={wetMassKg}
      wetMassLabel="Delivered wet mass"
      arrivalRegister={registration("truckMassOnArrivalKg")}
      departureRegister={registration("truckMassOnDepartureKg")}
    />,
  );
}

describe("TruckWeighingSection", () => {
  it("shows compact before/after unloading inputs", () => {
    const html = render(10_000);
    expect(html).toContain("Truck mass before unloading (kg)");
    expect(html).toContain("Truck mass after unloading (kg)");
    expect(html).not.toContain('role="alert"');
  });

  it("warns when observed truck difference and delivered wet mass differ", () => {
    const html = render(9_000);
    expect(html).toContain('role="alert"');
    expect(html).toContain("observed truck difference is");
    expect(html).toContain("10000.00 kg");
  });

  it("does not derive a mass from incomplete or reversed observations", () => {
    expect(deriveWeighbridgeWetMass(undefined, 5_000)).toBeNull();
    expect(deriveWeighbridgeWetMass(4_999, 5_000)).toBeNull();
  });
});
