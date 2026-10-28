// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import { RATIO_NOT_CALCULABLE, SampleDerivedRatios } from "./sample-derived-ratios";

afterEach(cleanup);

const certify = { certifyRequired: () => true, certifyStatus: (): CertFieldStatus => "satisfied" };
const OPEN_INFO = { name: "About Derived ratios" };

it("shows both figures and keeps the atomic formulas behind the (i)", async () => {
  render(<SampleDerivedRatios hToCOrgRatio={0.42} oToCOrgRatio={0.15} hydrogenPercent={2.5} oxygenPercent={12} organicCarbonPercent={71.5} oToCFromLab={false} {...certify} />);
  expect(screen.getByText("0.4200")).toBeTruthy();
  expect(screen.getByText("0.1500")).toBeTruthy();
  expect(screen.queryByText(/atomic ratio/)).toBeNull();
  fireEvent.click(screen.getByRole("button", OPEN_INFO));
  expect(await screen.findByText(/\(2\.5 \/ 1\.008\) \/ \(71\.5 \/ 12\.011\)/)).toBeTruthy();
  expect(screen.getByText(/\(12 \/ 15\.999\) \/ \(71\.5 \/ 12\.011\)/)).toBeTruthy();
});

it("credits a lab O:C org to the lab", async () => {
  render(<SampleDerivedRatios hToCOrgRatio={0.42} oToCOrgRatio={0.2} hydrogenPercent={2.5} oxygenPercent={12} organicCarbonPercent={71.5} oToCFromLab {...certify} />);
  expect(screen.getByText("0.4200")).toBeTruthy();
  expect(screen.getByText("0.2000")).toBeTruthy();
  expect(screen.queryByText(/comes from the lab ratio/)).toBeNull();
  fireEvent.click(screen.getByRole("button", OPEN_INFO));
  expect(await screen.findByText(/comes from the lab ratio entered above/)).toBeTruthy();
});

it("names a ratio it cannot derive and surfaces a refused derived value", () => {
  render(<SampleDerivedRatios hToCOrgRatio={null} oToCOrgRatio={null} hydrogenPercent={null} oxygenPercent={null} organicCarbonPercent={null} oToCFromLab={false} error="Ratio is above the saved precision." {...certify} />);
  expect(screen.getByText("Needs hydrogen and organic carbon")).toBeTruthy();
  expect(screen.getByText("Needs oxygen and organic carbon, or the O:C org ratio")).toBeTruthy();
  expect(screen.queryByText(/Not available/)).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("above the saved precision");
});

it("keeps the label and CERT tag with a reason when filled entries give no usable ratio", () => {
  const { container } = render(<SampleDerivedRatios hToCOrgRatio={null} oToCOrgRatio={0.15} hydrogenPercent={-1} oxygenPercent={12} organicCarbonPercent={71.5} oToCFromLab={false} {...certify} />);
  const shown = container.textContent ?? "";
  expect(shown).toContain("H:C org");
  expect(shown).toContain("CERT");
  expect(shown).toContain("O:C org");
  expect(shown.split(RATIO_NOT_CALCULABLE).length - 1).toBe(1);
});
