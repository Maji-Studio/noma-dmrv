import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { Facility } from "@/db/schema";
import { PartyFacilityDistances } from "./party-facility-distances";
import type { DistanceCalcField } from "./forms/distance-calc-field";

const captured = vi.hoisted(() => ({ rows: [] as ComponentProps<typeof DistanceCalcField>[] }));
const facilities = [
  { id: "first", name: "First plant", gpsLatitude: 0, gpsLongitude: 1 },
  { id: "second", name: "Second plant", gpsLatitude: 2, gpsLongitude: 3 },
] as Facility[];
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilities }) }));
vi.mock("./forms/distance-calc-field", () => ({ DistanceCalcField: (props: ComponentProps<typeof DistanceCalcField>) => {
  captured.rows.push(props);
  return <input aria-label={props.label} />;
} }));
beforeEach(() => { captured.rows = []; });

it("shows every org facility and changes only the selected pair when an estimate is accepted", () => {
  const onChange = vi.fn();
  const value = [{ facilityId: "first", distanceKm: 20, distanceSource: "document" as const }];
  renderToStaticMarkup(<PartyFacilityDistances value={value} onChange={onChange} idPrefix="distance" locationPoint={{ lat: 4, lng: 5 }} />);
  expect(captured.rows.map(row => row.distanceKm)).toEqual([20, undefined]);
  expect(onChange).not.toHaveBeenCalled();
  captured.rows[1].onDistanceChange(80, "map_estimate");
  expect(onChange).toHaveBeenCalledWith([...value, { facilityId: "second", distanceKm: 80, distanceSource: "map_estimate" }]);
});

it("quick-add shows only its active facility and preserves explicit clearing", () => {
  const onChange = vi.fn();
  renderToStaticMarkup(<PartyFacilityDistances facility={facilities[1]} value={[]} onChange={onChange} idPrefix="distance" locationPoint={null} />);
  expect(captured.rows).toHaveLength(1);
  expect(captured.rows[0].label).toBe("Distance to Second plant");
  captured.rows[0].onDistanceChange(null, null);
  expect(onChange).toHaveBeenCalledWith([{ facilityId: "second", distanceKm: null, distanceSource: "manual" }]);
});

it("shows a validation error beside the matching facility even when pair order differs", () => {
  renderToStaticMarkup(<PartyFacilityDistances
    value={[{ facilityId: "second", distanceKm: -1, distanceSource: "manual" }]}
    rowErrors={[{ distanceKm: { message: "Enter a positive distance." } }]}
    onChange={vi.fn()} idPrefix="distance" locationPoint={null}
  />);
  expect(captured.rows[0].error).toBeUndefined();
  expect(captured.rows[1].error).toBe("Enter a positive distance.");
});

it("merges a delayed estimate into the current form value without reverting another facility", () => {
  let value = [{ facilityId: "first", distanceKm: 20, distanceSource: "manual" as const }];
  const onChange = vi.fn();
  renderToStaticMarkup(<PartyFacilityDistances value={value} getValue={() => value} onChange={onChange} idPrefix="distance" locationPoint={null} />);
  const pendingEstimate = captured.rows[0].onDistanceChange;
  value = [...value, { facilityId: "second", distanceKm: 90, distanceSource: "manual" }];
  pendingEstimate(35, "map_estimate");
  expect(onChange).toHaveBeenCalledWith([
    { facilityId: "second", distanceKm: 90, distanceSource: "manual" },
    { facilityId: "first", distanceKm: 35, distanceSource: "map_estimate" },
  ]);
});
