import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";

export interface ApplicationDeliveryOption {
  id: string;
  code: string;
  deliveryDate: Date | string;
  orderCode: string | null;
  formulationName: string | null;
  massDryKg: number | null;
  deliveredWetMassKg: number | null;
  orderQuantityKg: number | null;
  moistureContentPercent: number | null;
  defaultSoilTemperatureC: number | null;
  facilityDefaultSoilTemperatureC: number | null;
  /** Total kg already applied from this delivery across all applications */
  alreadyAppliedWetKg: number;
}

export interface ApplicationSoilTemperatureDefault {
  soilTemperatureSource: "global_database";
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
    soilTemperatureSource: "global_database",
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

export function formatKg(value: number | null | undefined): string {
  if (value == null) {
    return "—";
  }

  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`;
}

function formatDeliveryDate(value: Date | string): string {
  return new Date(value).toLocaleDateString();
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
