import { useEffect, useRef } from "react";
import { facilityToday } from "@/lib/date-utils";

interface FacilityDateDefaultsOptions<Field extends string> {
  timeZone: string;
  isEditMode: boolean;
  fields: readonly Field[];
  isPristine: (field: Field) => boolean;
  setDefault: (field: Field, day: string) => void;
}

/** Keep untouched create dates on the resolved facility clock, including late context. */
export function useFacilityDateDefaults<Field extends string>({
  timeZone, isEditMode, fields, isPristine, setDefault,
}: FacilityDateDefaultsOptions<Field>) {
  const previousZone = useRef(timeZone);
  const editedFields = useRef(new Set<Field>());

  // Context can resolve after the picker event. Sync RHF's registered fields
  // after commit, using the same pristine check as the application picker.
  useEffect(() => {
    if (previousZone.current === timeZone) return;
    previousZone.current = timeZone;
    if (isEditMode) return;
    const today = facilityToday(timeZone);
    for (const field of fields) {
      if (!editedFields.current.has(field) && isPristine(field)) setDefault(field, today);
    }
  }, [timeZone, isEditMode, fields, isPristine, setDefault]);

  // RHF clears dirtiness when an edit returns to its default. That is still
  // an operator choice, so remember the change independently of dirtiness.
  return (field: Field) => { editedFields.current.add(field); };
}
