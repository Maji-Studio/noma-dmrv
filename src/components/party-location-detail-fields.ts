import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";
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
  facilityDistances: import("@/schemas/facility-distances").FacilityDistance[];
  isDefault: boolean;
  defaultSoilTemperatureC?: number | null;
  /** Set on an archived customer location; suppliers do not carry it. */
  archivedAt?: Date | null;
}

interface BuildPartyLocationDetailFieldsOptions {
  distanceLabel: string;
  defaultLabel: string;
  positionLabel: string;
  /** Label for the free-text location description. Defaults to the supplier wording. */
  descriptionLabel?: string;
  includeSoilTemperature?: boolean;
  pending?: boolean;
}

const DEFAULT_DESCRIPTION_LABEL = "Address / description";

/** Mirrors the location forms without dropping empty optional values. */
export function buildPartyLocationDetailFields(
  locations: PartyLocationDetail[],
  options: BuildPartyLocationDetailFieldsOptions,
): DetailPanelField[] {
  // Archived locations follow the active ones, so the numbering matches the edit sheet.
  const ordered = [...locations.filter((row) => !row.archivedAt), ...locations.filter((row) => row.archivedAt)];
  const rows = ordered.length > 0 ? ordered : [null];

  return rows.flatMap((location, index) => {
    const archivedMark = location?.archivedAt ? " (archived)" : "";
    const prefix = locations.length > 1 ? `Location ${index + 1}${archivedMark} · ` : "";
    const fields: DetailPanelField[] = [
      { label: `${prefix}Location name`, value: location?.name ?? null },
      { label: `${prefix}Country`, value: location?.country ?? null },
      { label: `${prefix}State / region`, value: location?.stateRegion ?? null },
      { label: `${prefix}City`, value: location?.city ?? null },
      {
        label: `${prefix}${options.descriptionLabel ?? DEFAULT_DESCRIPTION_LABEL}`,
        value: location?.address ?? null,
      },
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
        value: location?.facilityDistances.map(row => `${row.facilityName ?? row.facilityId}: ${formatDistanceKm(row.distanceKm)} (${DISTANCE_SOURCE_LABELS[row.distanceSource]})`).join("; ") || null,
      },
      {
        label: `${prefix}${options.defaultLabel}`,
        value: location ? (location.isDefault ? "Yes" : "No") : null,
      },
    );

    return fields.map((field) => ({ ...field, pending: options.pending }));
  });
}
