/**
 * Accept-invitation landing page. Existing users sign in with the invited
 * address; new users can bootstrap an account from the invitation token.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/server";
import { AcceptInvitation } from "@/components/organizations/accept-invitation";
import { InvitationBootstrapForm } from "@/components/organizations/invitation-bootstrap-form";
import { getInvitationBootstrapState } from "@/fn/invitation-bootstrap";

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invitationResult = await getInvitationBootstrapState({
    invitationId: id,
  });
  if (!invitationResult.success) {
    return <InvitationCard error={invitationResult.error} />;
  }

  const invitation = invitationResult.data;
  const user = await getUser();
  if (invitation.accountExists && !user) {
    redirect(`/login?from=${encodeURIComponent(`/accept-invitation/${id}`)}`);
  }

  // A signed-in user can only accept with the invited address; bootstrap is
  // for anonymous visitors, so any active session must be signed out first.
  if (user && user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <InvitationCard error="Sign out, then sign in with the invited email address." />
    );
  }

  return (
    <InvitationCard>
      {invitation.accountExists && user ? (
        <AcceptInvitation invitationId={id} userEmail={user.email} />
      ) : (
        <InvitationBootstrapForm
          invitationId={id}
          email={invitation.email}
        />
      )}
    </InvitationCard>
  );
}

function InvitationCard({
  children,
  error,
}: {
  children?: ReactNode;
  error?: string;
}) {
  return (
    <div className="w-full max-w-[400px] mx-auto">
      <div className="mb-32 text-center">
        <h1 className="title-heading-2 mb-16">Join organization</h1>
        <p className="body-medium text-[var(--color-text-secondary)]">
          You&apos;ve been invited to collaborate.
        </p>
      </div>
      <div className="bg-[var(--color-background-white)] border border-[var(--color-border-primary)] p-32 shadow-sm">
        {error ? (
          <p className="body-small text-[var(--st-bad)] border border-[var(--st-bad-border)] bg-[var(--st-bad-bg)] p-12">
            {error}
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
