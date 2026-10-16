"use client";

import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import { formatRoundTripKm } from "@/lib/format-utils";
import { DistanceCalcField } from "@/components/forms/distance-calc-field";
import { useFacilityContext } from "@/hooks/use-facility-context";
import type { Facility } from "@/db/schema";
import type { FacilityDistanceInput } from "@/schemas/facility-distances";
import type { GeoPoint } from "@/lib/geo/types";

interface PartyFacilityDistancesProps {
  value: FacilityDistanceInput[] | undefined;
  savedValue?: FacilityDistanceInput[];
  isEditMode?: boolean;
  getValue?: () => FacilityDistanceInput[] | undefined;
  onChange: (value: FacilityDistanceInput[]) => void;
  locationPoint: GeoPoint | null;
  idPrefix: string;
  disabled?: boolean;
  /** Contextual editors can restrict rows to their active facility. */
  facility?: Facility;
  error?: string;
  rowErrors?: { readonly [index: number]: { distanceKm?: { message?: string } } | undefined };
  fromFacility?: boolean;
}

export function PartyFacilityDistances({ value = [], savedValue = [], isEditMode = false, getValue, onChange, locationPoint, idPrefix, disabled, facility, error, rowErrors, fromFacility = false }: PartyFacilityDistancesProps) {
  const { facilities } = useFacilityContext();
  const rows = (facility ? [facility] : facilities).filter(item => !item.archivedAt);
  return <div className="space-y-16" data-testid="facility-distances">
    {rows.map(item => {
      const valueIndex = value.findIndex(row => row.facilityId === item.id);
      const draftRow = value[valueIndex];
      return <div key={item.id} data-testid={`facility-distance-${item.id}`}><DistanceCalcField
        id={`${idPrefix}-${item.id}`}
        label={`Distance ${fromFacility ? "from" : "to"} ${item.name}`}
        helperText="One-way road distance. GPS estimates are editable estimates. Every delivery counts the round trip."
        cue={draftRow?.distanceKm != null ? formatRoundTripKm(draftRow.distanceKm) : undefined}
        certifyRequired={isCertifyFormField(fromFacility ? "customerLocation" : "supplierLocation", "facilityDistances")}
        certifyStatus={!isEditMode ? "neutral" : savedValue.some(row => row.facilityId === item.id && row.distanceKm != null) ? "satisfied" : "missing"}
        disabled={disabled}
        error={rowErrors?.[valueIndex]?.distanceKm?.message ?? error}
        distanceKm={draftRow?.distanceKm}
        distanceSource={draftRow?.distanceSource}
        onDistanceChange={(distanceKm, source) => onChange([
          ...(getValue?.() ?? value).filter(row => row.facilityId !== item.id),
          { facilityId: item.id, distanceKm, distanceSource: source ?? "manual" },
        ])}
        origin={fromFacility ? { lat: item.gpsLatitude, lng: item.gpsLongitude } : locationPoint}
        destination={fromFacility ? locationPoint : { lat: item.gpsLatitude, lng: item.gpsLongitude }}
        originLabel={fromFacility ? `facility ${item.name}` : "location"}
        destinationLabel={fromFacility ? "application site position" : item.name}
      /></div>;
    })}
  </div>;
}
