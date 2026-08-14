import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import { formatWetDryMass } from "@/lib/mass-moisture";
import { formatRemainingMass } from "@/components/forms/entity-select/remaining-mass";
import type { SoilTemperatureSource } from "@/schemas/applications";
import type { DeliveryStatus } from "@/schemas/deliveries";
import { MISSING_VALUE } from "@/lib/copy-utils";

/** The only source a delivery-derived prefill can assert (approved global dataset). */
export const SOIL_TEMPERATURE_SOURCE_GLOBAL =
  "global_database" satisfies SoilTemperatureSource;

export interface ApplicationDeliveryOption {
  id: string;
  code: string;
  status: DeliveryStatus;
  deliveryDate: Date | string;
  orderCode: string | null;
  formulationName: string | null;
  productBinName: string | null;
  massDryKg: number | null;
  deliveredWetMassKg: number | null;
  orderQuantityKg: number | null;
  moistureContentPercent: number | null;
  defaultSoilTemperatureC: number | null;
  facilityDefaultSoilTemperatureC: number | null;
  destinationGpsLatitude: number | null;
  destinationGpsLongitude: number | null;
  /** Total kg already applied from this delivery across all applications */
  alreadyAppliedWetKg: number;
  /** Total dry kg already applied from this delivery across all applications */
  alreadyAppliedDryKg: number;
}

export interface ApplicationPositionDefault {
  gpsLatitude: number;
  gpsLongitude: number;
}

/**
 * Default field position from the delivery's destination customer location.
 * Requires both coordinates — a destination with partial/no GPS yields no
 * prefill (the position schema enforces lat/lng as a pair).
 */
export function resolveApplicationPositionDefault({
  delivery,
}: {
  delivery:
    | Pick<
        ApplicationDeliveryOption,
        "destinationGpsLatitude" | "destinationGpsLongitude"
      >
    | null
    | undefined;
}): ApplicationPositionDefault | null {
  const gpsLatitude = delivery?.destinationGpsLatitude ?? null;
  const gpsLongitude = delivery?.destinationGpsLongitude ?? null;

  if (gpsLatitude == null || gpsLongitude == null) {
    return null;
  }

  return { gpsLatitude, gpsLongitude };
}

export interface ApplicationSoilTemperatureDefault {
  soilTemperatureSource: typeof SOIL_TEMPERATURE_SOURCE_GLOBAL;
  soilTemperatureC: number;
}

export function resolveApplicationSoilTemperatureDefault({
  delivery,
}: {
  delivery:
    | Pick<
        ApplicationDeliveryOption,
        "defaultSoilTemperatureC" | "facilityDefaultSoilTemperatureC"
      >
    | null
    | undefined;
}): ApplicationSoilTemperatureDefault | null {
  const soilTemperatureC =
    delivery?.defaultSoilTemperatureC ??
    delivery?.facilityDefaultSoilTemperatureC ??
    null;

  if (soilTemperatureC == null) {
    return null;
  }

  return {
    soilTemperatureSource: SOIL_TEMPERATURE_SOURCE_GLOBAL,
    soilTemperatureC,
  };
}

export function applicationTonsToKg(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  return value * KG_PER_TONNE;
}

export function applicationKgToTons(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  return value / KG_PER_TONNE;
}

/** Kept as a named re-export so the application surfaces keep one import site. */
export const formatKg = formatMassKg;

function formatDeliveryDate(value: Date | string): string {
  return formatDate(value);
}

export function getApplicationDeliveryMassLabel(delivery: ApplicationDeliveryOption): string | null {
  if (delivery.deliveredWetMassKg != null) {
    return formatWetDryMass({
      wetKg: delivery.deliveredWetMassKg,
      dryKg: delivery.massDryKg,
      moisturePercent: delivery.moistureContentPercent,
      wetLabel: "Wet biochar product",
      dryLabel: "Dry biochar",
      separator: " | ",
      unitSpacing: "compact",
    });
  }

  if (delivery.massDryKg != null) {
    return formatWetDryMass({
      wetKg: null,
      dryKg: delivery.massDryKg,
      wetLabel: "Wet biochar product",
      dryLabel: "Dry biochar",
      separator: " | ",
      unitSpacing: "compact",
    });
  }

  if (delivery.orderQuantityKg != null) {
    return formatWetDryMass({
      wetKg: delivery.orderQuantityKg,
      dryKg: null,
      wetLabel: "Wet biochar product",
      dryLabel: "Dry biochar",
      separator: " | ",
      unitSpacing: "compact",
    });
  }

  return null;
}

export function formatApplicationDeliveryOptionLabel(delivery: ApplicationDeliveryOption): string {
  return [
    delivery.productBinName,
    delivery.formulationName,
    formatDeliveryDate(delivery.deliveryDate),
    getApplicationDeliveryMassLabel(delivery),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatApplicationDeliveryHelperText(delivery: ApplicationDeliveryOption): string {
  const remainingWetKg =
    delivery.deliveredWetMassKg == null
      ? null
      : Math.max(0, delivery.deliveredWetMassKg - delivery.alreadyAppliedWetKg);
  const deliveredDryKg = delivery.massDryKg;
  const remainingDryKg =
    deliveredDryKg == null
      ? null
      : Math.max(0, deliveredDryKg - delivery.alreadyAppliedDryKg);

  return formatRemainingMass({
    wetKg: remainingWetKg,
    dryKg: remainingDryKg,
  });
}

export function formatApplicationKgFromTons(value: number | null | undefined): string {
  return formatKg(applicationTonsToKg(value));
}

/** Field size is a surveyed parcel area — two decimals resolve a 100 m² strip. */
const FIELD_SIZE_HA_FRACTION_DIGITS = 2;
/**
 * Field size in hectares, one precision for every read surface (list column,
 * detail sheet, entity card). The unit rides with the value so a row and a
 * detail row can never disagree about which of the two carries it.
 * Returns "Not recorded" for null/undefined.
 */
export function formatFieldSizeHa(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return MISSING_VALUE.notRecorded;
  return `${value.toFixed(FIELD_SIZE_HA_FRACTION_DIGITS)} ha`;
}
