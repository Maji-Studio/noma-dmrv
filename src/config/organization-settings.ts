/**
 * The fallback an organization gets before anyone opens `/settings/defaults`.
 *
 * These values mirror the column defaults on `organization_settings`
 * (`@/db/schema/settings`), which in turn mirror the literals they replaced.
 * Keeping them in `@/config` rather than in data-access means a client
 * component can render the same fallback the server would resolve, without
 * importing the schema.
 *
 * Changing a value here changes behaviour for every organization that has never
 * chosen for itself — which is the point, and also the reason to change one
 * only deliberately.
 */
import type { CurrencyCode } from "@/schemas/credit-batches";
import type { Timezone } from "@/schemas/facilities";
import type { TripTypeValue } from "@/schemas/trip-type";

export interface OrganizationDefaults {
  defaultCurrency: CurrencyCode;
  /** `null` = the organization has not named a country. */
  defaultCountry: string | null;
  /**
   * IANA zone. Stays a plain `string` because the column is free text and a
   * seeded or hand-edited row may hold a zone the picker does not offer —
   * narrowing the read type here would be a claim the database does not make.
   * Consumers that need the narrow type guard against the offered list.
   */
  defaultTimezone: string;
  defaultTripType: TripTypeValue;
  defaultEvidenceMethod: "visual" | "boundary";
  defaultPackaging: "loose" | "bagged";
}

/** Exported narrow so a picker can use it as a fallback without re-guarding. */
export const DEFAULT_ORGANIZATION_TIMEZONE: Timezone = "UTC";

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationDefaults = {
  defaultCurrency: "TZS",
  defaultCountry: null,
  defaultTimezone: DEFAULT_ORGANIZATION_TIMEZONE,
  defaultTripType: "return",
  defaultEvidenceMethod: "visual",
  defaultPackaging: "loose",
};
