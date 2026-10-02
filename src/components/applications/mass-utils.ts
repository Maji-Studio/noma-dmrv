import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { DEFAULT_FACILITY_TIMEZONE } from "@/lib/date-utils";
import { formatDayString, formatFacilityDay, formatMassKg } from "@/lib/format-utils";
import { formatWetDryStock } from "@/lib/mass-moisture";
import { formatRemainingMass } from "@/components/forms/entity-select/remaining-mass";
import type { SoilTemperatureSource } from "@/schemas/applications";
import type { DeliveryStatus } from "@/schemas/deliveries";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatStockLimitKg } from "@/lib/stock-overdraw";

/** The only source a delivery-derived prefill can assert (approved global dataset). */
export const SOIL_TEMPERATURE_SOURCE_GLOBAL =
  "global_database" satisfies SoilTemperatureSource;

export interface ApplicationDeliveryOption {
  id: string;
  code: string;
  status: DeliveryStatus;
  deliveryDate: Date | string;
  /** The delivery's calendar day on its facility clock ("YYYY-MM-DD"). */
  deliveryDay?: string | null;
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

/**
 * The delivery's calendar day on its facility clock, never the viewer's. The
 * server resolves `deliveryDay` in the facility zone; a delivery without one
 * (no facility row) falls back to the zone a missing facility resolves to.
 */
export function formatApplicationDeliveryDay(delivery: Pick<ApplicationDeliveryOption, "deliveryDate" | "deliveryDay">): string {
  return delivery.deliveryDay
    ? formatDayString(delivery.deliveryDay)
    : formatFacilityDay(delivery.deliveryDate, DEFAULT_FACILITY_TIMEZONE);
}

export function getApplicationDeliveryMassLabel(delivery: ApplicationDeliveryOption): string | null {
  if (delivery.deliveredWetMassKg != null) {
    return formatWetDryStock({ wetKg: delivery.deliveredWetMassKg, dryKg: delivery.massDryKg });
  }

  if (delivery.massDryKg != null) {
    return formatWetDryStock({ wetKg: null, dryKg: delivery.massDryKg });
  }

  if (delivery.orderQuantityKg != null) {
    return formatWetDryStock({ wetKg: delivery.orderQuantityKg, dryKg: null });
  }

  return null;
}

export function formatApplicationDeliveryOptionLabel(delivery: ApplicationDeliveryOption): string {
  return [
    delivery.productBinName,
    delivery.formulationName,
    formatApplicationDeliveryDay(delivery),
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

export interface ApplicationStockCues {
  /** Below the delivery picker: the delivery's remaining stock. */
  deliveryCue: string | undefined;
  /** Below the applied mass: what this application may draw. */
  appliedMassCue: string | undefined;
}

/**
 * The stock figures the application form shows. On edit the applied mass cue
 * already counts this application's own draw, so the delivery's Remaining now
 * line would be a second, near-identical figure: edit shows one figure only.
 */
export function applicationStockCues({
  delivery,
  availableKg,
  isEditMode,
}: {
  delivery: ApplicationDeliveryOption | undefined;
  availableKg: number | null;
  isEditMode: boolean;
}): ApplicationStockCues {
  return {
    deliveryCue:
      delivery && !isEditMode
        ? formatApplicationDeliveryHelperText(delivery)
        : undefined,
    appliedMassCue:
      availableKg !== null
        ? `${formatStockLimitKg(availableKg)} available ${isEditMode ? "to this application" : "from this delivery"}`
        : undefined,
  };
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
