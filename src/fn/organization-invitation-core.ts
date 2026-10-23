import { getActiveOrganization } from "@/data-access/organizations";
import { getBetterAuthSession } from "@/lib/auth/providers/better-auth-server";
import type { OrgContext } from "@/lib/auth/server";
import { sendOrganizationInvitation } from "@/lib/email/organization-invitation";
import { SafeError } from "@/lib/errors";

/**
 * The signed-in user's name for invitation wording. A failed lookup must never
 * fail the action: the email then falls back to wording without a name.
 */
async function currentUserName(): Promise<string | undefined> {
  try {
    return (await getBetterAuthSession())?.user.name || undefined;
  } catch {
    return undefined;
  }
}

/** Resolve presentation data before writing; deliver exactly once after commit. */
export async function createAndDeliverInvitation(
  ctx: OrgContext,
  createInvitation: () => Promise<{ id: string; email: string; role: string }>,
) {
  const organization = await getActiveOrganization(ctx);
  if (!organization) throw new SafeError("Organization not found.");
  const inviterName = await currentUserName();
  const invitation = await createInvitation();
  const delivery = await sendOrganizationInvitation({
    invitationId: invitation.id,
    organizationId: ctx.organizationId,
    organizationName: organization.name,
    inviterName,
    email: invitation.email,
    role: invitation.role,
  });
  return { invitationId: invitation.id, ...delivery };
}
