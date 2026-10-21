// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useForm, useWatch } from "react-hook-form";
import { facilityToday, UNKNOWN_FACILITY_TIMEZONE } from "@/lib/date-utils";
import { useFacilityDateDefaults } from "./use-facility-date-defaults";

const FACILITY_ZONE = "Africa/Dar_es_Salaam";
const NOW = new Date("2026-10-21T22:00:00Z");
const INITIAL_DAY = "2026-10-21";
const FACILITY_DAY = "2026-10-22";
const EDITED_DAY = "2026-10-19";
const DATE_FIELDS = ["deliveryDate", "orderDate", "applicationDate"] as const;
type DateField = (typeof DATE_FIELDS)[number];

function Form({ resolvedZone, isEditMode = false }: { resolvedZone?: string; isEditMode?: boolean }) {
  const { register, control, getFieldState, resetField, formState } = useForm({
    defaultValues: {
      facilityId: "", deliveryDate: facilityToday(UNKNOWN_FACILITY_TIMEZONE),
      orderDate: INITIAL_DAY, applicationDate: INITIAL_DAY,
    },
  });
  const facilityId = useWatch({ control, name: "facilityId" });
  const timeZone = resolvedZone ?? (facilityId ? FACILITY_ZONE : UNKNOWN_FACILITY_TIMEZONE);
  const markEdited = useFacilityDateDefaults({
    timeZone, isEditMode, fields: DATE_FIELDS,
    isPristine: (field) => !getFieldState(field).isDirty,
    setDefault: (field, day) => resetField(field, { defaultValue: day }),
  });
  return <>
    <select aria-label="Facility" {...register("facilityId")}>
      <option value="">Select facility</option>
      <option value="facility">Facility</option>
    </select>
    {DATE_FIELDS.map((field) => <input key={field} aria-label={field} type="date"
      {...register(field, { onChange: () => markEdited(field) })} />)}
    <output>{String(formState.dirtyFields.orderDate ?? false)}</output>
  </>;
}

const dateInput = (field: DateField) => screen.getByLabelText(field) as HTMLInputElement;
const chooseFacility = () => fireEvent.change(screen.getByLabelText("Facility"), { target: { value: "facility" } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("facility date defaults shared by feedstock, order and application forms", () => {
  it.each(DATE_FIELDS)("moves pristine %s when the facility is selected after mount", (field) => {
    render(<Form />);
    expect(dateInput(field).value).toBe(INITIAL_DAY);
    chooseFacility();
    expect(dateInput(field).value).toBe(FACILITY_DAY);
  });

  it.each(DATE_FIELDS)("preserves an operator edit to %s", (field) => {
    render(<Form />);
    fireEvent.change(dateInput(field), { target: { value: EDITED_DAY } });
    chooseFacility();
    expect(dateInput(field).value).toBe(EDITED_DAY);
  });

  it("preserves an edit returned to its original day and updates the other dates", () => {
    render(<Form />);
    fireEvent.change(dateInput("orderDate"), { target: { value: EDITED_DAY } });
    fireEvent.change(dateInput("orderDate"), { target: { value: INITIAL_DAY } });
    expect(screen.getByRole("status").textContent).toBe("false");
    chooseFacility();
    expect(dateInput("orderDate").value).toBe(INITIAL_DAY);
    expect(dateInput("applicationDate").value).toBe(FACILITY_DAY);
  });

  it("updates untouched dates when the facility zone arrives late", () => {
    const { rerender } = render(<Form />);
    rerender(<Form resolvedZone={FACILITY_ZONE} />);
    for (const field of DATE_FIELDS) expect(dateInput(field).value).toBe(FACILITY_DAY);
  });

  it("preserves saved dates in edit mode", () => {
    const { rerender } = render(<Form isEditMode />);
    rerender(<Form isEditMode resolvedZone={FACILITY_ZONE} />);
    for (const field of DATE_FIELDS) expect(dateInput(field).value).toBe(INITIAL_DAY);
  });
});
