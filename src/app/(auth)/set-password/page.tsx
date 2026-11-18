/**
 * Set password page
 * Used for initial password setup from admin invite
 */
import { Suspense } from "react";
import { SetPasswordForm } from "@/components/auth";
import { getInvitationBootstrapState } from "@/fn/invitation-bootstrap";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string | string[] }>;
}) {
  const { invitation: invitationParam } = await searchParams;
  const invitationId = typeof invitationParam === "string" ? invitationParam : null;
  // An invalid or expired invitation falls back to the plain flow.
  const state = invitationId
    ? await getInvitationBootstrapState({ invitationId })
    : null;
  const invitation = state?.success
    ? { id: state.data.invitationId, email: state.data.email }
    : undefined;

  return (
    <div className="w-full max-w-[400px] mx-auto">
      <div className="mb-32 text-center">
        <h1 className="title-heading-2">Welcome!</h1>
      </div>

      <div className="bg-[var(--color-background-white)] rounded-none border border-[var(--color-border-primary)] p-32 shadow-sm">
        <Suspense
          fallback={
            <div className="text-center py-32 text-[var(--color-text-secondary)]">
              Loading...
            </div>
          }
        >
          <SetPasswordForm invitation={invitation} />
        </Suspense>
      </div>
    </div>
  );
}
