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
import type { ApplicationEvidenceMethod } from "@/schemas/applications";
import type { PackagingType } from "@/schemas/orders";

export interface OrganizationDefaults {
  /** `null` = the organization has not named a country. */
  defaultCountry: string | null;
  /**
   * IANA zone. `null` = the organization has not chosen one; no zone is assumed
   * for it, because a wrong day attribution is worse than an empty field. Stays
   * a plain `string` because the column is free text and a seeded or hand-edited
   * row may hold a zone the picker does not offer.
   */
  defaultTimezone: string | null;
  defaultEvidenceMethod: ApplicationEvidenceMethod;
  defaultPackaging: PackagingType;
}

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationDefaults = {
  defaultCountry: null,
  defaultTimezone: null,
  defaultEvidenceMethod: "location",
  defaultPackaging: "loose",
};
