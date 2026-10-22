import { getActiveOrganization } from "@/data-access/organizations";
import type { OrgContext } from "@/lib/auth/server";
import { sendOrganizationInvitation } from "@/lib/email/organization-invitation";
import { SafeError } from "@/lib/errors";

/** Resolve presentation data before writing; deliver exactly once after commit. */
export async function createAndDeliverInvitation(
  ctx: OrgContext,
  createInvitation: () => Promise<{ id: string; email: string; role: string }>,
) {
  const organization = await getActiveOrganization(ctx);
  if (!organization) throw new SafeError("Organization not found.");
  const invitation = await createInvitation();
  const delivery = await sendOrganizationInvitation({
    invitationId: invitation.id,
    organizationId: ctx.organizationId,
    organizationName: organization.name,
    email: invitation.email,
    role: invitation.role,
  });
  return { invitationId: invitation.id, ...delivery };
}
