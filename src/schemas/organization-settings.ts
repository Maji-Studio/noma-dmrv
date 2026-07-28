/**
 * Organization operating-defaults form and action schema.
 *
 * Shared by `/settings/defaults` (react-hook-form + zodResolver) and
 * `src/fn/organization-settings.ts`, so client validation and the server trust
 * boundary cannot drift. `organizationId` is never in this payload — it is
 * stamped server-side from the session's active organization.
 */
import { z } from "zod";
import { currencyCodes } from "./credit-batches";
import { timezones } from "./facilities";
import { tripTypes } from "./trip-type";

const MAX_ORGANIZATION_COUNTRY_LENGTH = 100;

export const applicationEvidenceMethods = ["visual", "boundary"] as const;
export const packagingTypes = ["loose", "bagged"] as const;

export const organizationSettingsFormSchema = z.object({
  defaultCurrency: z.enum(currencyCodes),
  /**
   * Free text, matching `facilities.country`. An empty input means "we have not
   * said", which is stored as null rather than as the `'UNKNOWN'` that facility
   * and party rows persist — a default nobody chose should not look chosen.
   */
  defaultCountry: z
    .string()
    .trim()
    .max(
      MAX_ORGANIZATION_COUNTRY_LENGTH,
      `Country must be ${MAX_ORGANIZATION_COUNTRY_LENGTH} characters or fewer.`,
    )
    .transform((value) => value || null)
    .nullable(),
  defaultTimezone: z.enum(timezones),
  defaultTripType: z.enum(tripTypes),
  defaultEvidenceMethod: z.enum(applicationEvidenceMethods),
  defaultPackaging: z.enum(packagingTypes),
});

/** What the form holds. `defaultCountry` is a string in the input, null after parse. */
export type OrganizationSettingsInput = z.input<
  typeof organizationSettingsFormSchema
>;
export type OrganizationSettingsValues = z.output<
  typeof organizationSettingsFormSchema
>;
