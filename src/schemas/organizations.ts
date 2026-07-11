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
