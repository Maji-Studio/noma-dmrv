import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import type { SoilTemperatureSource } from "@/schemas/applications";
import type { DeliveryStatus } from "@/schemas/deliveries";

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

/**
 * Calculate dry mass from wet mass and moisture content.
 * Formula: dryKg = wetKg * (1 - moisturePercent / 100)
 */
export function calculateDryMass(
  wetKg: number | null | undefined,
  moisturePercent: number | null | undefined,
): number | null {
  if (wetKg == null || moisturePercent == null) return null;
  if (wetKg < 0 || moisturePercent < 0 || moisturePercent > 100) return null;
  return deriveMassDryKg(wetKg, moisturePercent);
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
  if (delivery.massDryKg != null) {
    return `${formatKg(delivery.massDryKg)} dry`;
  }

  if (delivery.deliveredWetMassKg != null) {
    return `${formatKg(delivery.deliveredWetMassKg)} delivered`;
  }

  if (delivery.orderQuantityKg != null) {
    return `${formatKg(delivery.orderQuantityKg)} ordered`;
  }

  return null;
}

export function formatApplicationDeliveryOptionLabel(delivery: ApplicationDeliveryOption): string {
  return [
    delivery.orderCode ?? delivery.code,
    delivery.formulationName,
    getApplicationDeliveryMassLabel(delivery),
    formatDeliveryDate(delivery.deliveryDate),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatApplicationDeliveryHelperText(delivery: ApplicationDeliveryOption): string {
  return [
    `Delivery ${delivery.code}`,
    getApplicationDeliveryMassLabel(delivery),
    formatDeliveryDate(delivery.deliveryDate),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatApplicationKgFromTons(value: number | null | undefined): string {
  return formatKg(applicationTonsToKg(value));
}
