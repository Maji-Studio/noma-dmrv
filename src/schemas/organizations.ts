/**
 * Organization form/action schemas (multi-tenancy PR 1).
 * Shared by the settings/admin forms (react-hook-form + zodResolver) and the
 * server actions in src/fn/organizations.ts, so client validation and the
 * server trust boundary can't drift.
 */
import { z } from "zod";

export const INVITATION_PASSWORD_MIN_LENGTH = 8;
export const INVITATION_PASSWORD_MAX_LENGTH = 72;

export const orgRoleSchema = z.enum(["owner", "admin", "member"]);
export type OrgRoleValue = z.infer<typeof orgRoleSchema>;

export const inviteMemberSchema = z.object({
  // Normalize before validating — z.email() would reject padded input first.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address.")),
  role: orgRoleSchema,
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9-]+$/,
      "Slug may only contain lowercase letters, numbers, and hyphens."
    ),
  ownerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid owner email.")),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/**
 * First-time credential entry: both halves have to be typed, because there is
 * nothing stored to fall back on.
 */
const MASK_CHARACTER = "\u2022";
export const CERTIFIER_CREDENTIAL_MASK = MASK_CHARACTER.repeat(16);
const MASK_CONTAMINATION_MESSAGE =
  "Remove the masked placeholder before entering a key.";

function credentialFormValueSchema(requiredMessage: string) {
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .refine((value) => !value.includes(MASK_CHARACTER), {
      message: MASK_CONTAMINATION_MESSAGE,
    });
}

export const certifierCredentialsFormSchema = z.object({
  accessToken: credentialFormValueSchema("Access token is required."),
  clientSecret: credentialFormValueSchema("Client secret is required."),
});
export type CertifierCredentialsFormInput = z.infer<
  typeof certifierCredentialsFormSchema
>;

/**
 * Rotation: the settings form keeps both inputs on screen once credentials
 * exist, seeded with a masked stand-in. A field left at its mask (or cleared
 * and not retyped) means "leave this one alone", so neither is required here.
 * Infers the same shape as the create schema, so one form type serves both.
 */
export const certifierCredentialsRotationSchema = z.object({
  accessToken: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === CERTIFIER_CREDENTIAL_MASK ||
        !value.includes(MASK_CHARACTER),
      { message: MASK_CONTAMINATION_MESSAGE },
    ),
  clientSecret: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === CERTIFIER_CREDENTIAL_MASK ||
        !value.includes(MASK_CHARACTER),
      { message: MASK_CONTAMINATION_MESSAGE },
    ),
});

const organizationIdSchema = z
  .string()
  .trim()
  .min(1, "Organization id is required.");

/**
 * The settings form seeds a stored field with a run of bullets and drops any
 * field still holding it. Rejecting that shape here too means a hand-rolled
 * request, or a future caller that forgets to strip it, cannot store the mask
 * as a real key — a credential made only of `\u2022` is never a real one.
 */
const secretSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes(MASK_CHARACTER), {
    message: "That is the placeholder for a stored key, not a key.",
  });

/**
 * The action payload. Both secrets are optional so a rotation can carry only
 * the half that changed; the data-access layer keeps the stored value for an
 * omitted field and rejects a first save that omits either.
 */
export const setOrgCertifierCredentialsSchema = z
  .object({
    organizationId: organizationIdSchema,
    accessToken: secretSchema.optional(),
    clientSecret: secretSchema.optional(),
  })
  .refine((values) => values.accessToken || values.clientSecret, {
    message: "Enter an access token or a client secret to save.",
  });

export const orgCertifierCredentialsTargetSchema = z.object({
  organizationId: organizationIdSchema,
});

export const invitationIdSchema = z.object({
  invitationId: z.string().trim().min(1, "Invitation id is required."),
});

export const invitationBootstrapSchema = invitationIdSchema.extend({
  name: z.string().trim().min(1, "Name is required."),
  password: z
    .string()
    .min(
      INVITATION_PASSWORD_MIN_LENGTH,
      `Password must be at least ${INVITATION_PASSWORD_MIN_LENGTH} characters.`
    )
    .max(
      INVITATION_PASSWORD_MAX_LENGTH,
      `Password must be at most ${INVITATION_PASSWORD_MAX_LENGTH} characters.`
    ),
});
export type InvitationBootstrapInput = z.infer<
  typeof invitationBootstrapSchema
>;
