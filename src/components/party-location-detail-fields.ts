import type { DetailPanelField } from "@/components/ui/detail-panel";
import { formatDistanceKm } from "@/lib/format-utils";

export interface PartyLocationDetail {
  name: string | null;
  country: string;
  stateRegion: string | null;
  city: string | null;
  address: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  distanceFromFacilityKm: number | null;
  isDefault: boolean;
  defaultSoilTemperatureC?: number | null;
}

interface BuildPartyLocationDetailFieldsOptions {
  distanceLabel: string;
  defaultLabel: string;
  positionLabel: string;
  includeSoilTemperature?: boolean;
}

/** Mirrors the location forms without dropping empty optional values. */
export function buildPartyLocationDetailFields(
  locations: PartyLocationDetail[],
  options: BuildPartyLocationDetailFieldsOptions,
): DetailPanelField[] {
  const rows = locations.length > 0 ? locations : [null];

  return rows.flatMap((location, index) => {
    const prefix = locations.length > 1 ? `Location ${index + 1} · ` : "";
    const fields: DetailPanelField[] = [
      { label: `${prefix}Location name`, value: location?.name ?? null },
      { label: `${prefix}Country`, value: location?.country ?? null },
      { label: `${prefix}State / region`, value: location?.stateRegion ?? null },
      { label: `${prefix}City`, value: location?.city ?? null },
      { label: `${prefix}Address / description`, value: location?.address ?? null },
      { label: `${prefix}${options.positionLabel} latitude`, value: location?.gpsLatitude ?? null },
      { label: `${prefix}${options.positionLabel} longitude`, value: location?.gpsLongitude ?? null },
    ];

    if (options.includeSoilTemperature) {
      fields.push({
        label: `${prefix}Default soil temperature (°C)`,
        value:
          location?.defaultSoilTemperatureC != null
            ? `${location.defaultSoilTemperatureC} °C`
            : null,
      });
    }

    fields.push(
      {
        label: `${prefix}${options.distanceLabel}`,
        value: formatDistanceKm(location?.distanceFromFacilityKm),
      },
      {
        label: `${prefix}${options.defaultLabel}`,
        value: location ? (location.isDefault ? "Yes" : "No") : null,
      },
    );

    return fields;
  });
}
