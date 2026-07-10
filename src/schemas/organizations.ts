/**
 * Organization form/action schemas (multi-tenancy PR 1).
 * Shared by the settings/admin forms (react-hook-form + zodResolver) and the
 * server actions in src/fn/organizations.ts, so client validation and the
 * server trust boundary can't drift.
 */
import { z } from "zod";

export const orgRoleSchema = z.enum(["owner", "admin", "member"]);
export type OrgRoleValue = z.infer<typeof orgRoleSchema>;

export const inviteMemberSchema = z.object({
  email: z
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase().trim()),
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
    .email("Enter a valid owner email.")
    .transform((value) => value.toLowerCase().trim()),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
