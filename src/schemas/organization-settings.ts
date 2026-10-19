/**
 * Organization operating-defaults form and action schema.
 *
 * Shared by `/settings/defaults` (react-hook-form + zodResolver) and
 * `src/fn/organization-settings.ts`, so client validation and the server trust
 * boundary cannot drift. `organizationId` is never in this payload: it is
 * stamped server-side from the session's active organization.
 */
import { z } from "zod";
import { applicationEvidenceMethods } from "./applications";
import { packagingTypes } from "./orders";
import { optionalTimezoneSchema } from "./timezone";

const MAX_ORGANIZATION_COUNTRY_LENGTH = 100;

export const organizationSettingsFormSchema = z.object({
  /**
   * Free text, matching `facilities.country`. An empty input means "we have not
   * said", which is stored as null. A default nobody chose should not look chosen.
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
  /** Optional: an organization may have no deliberate default. */
  defaultTimezone: optionalTimezoneSchema(),
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
