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
import { AuthLink, AuthResult } from "@/components/auth/auth-result";
import { SignOutAndReturn } from "@/components/auth/sign-out-and-return";

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
      <AuthResult
        tone="error"
        title="Signed in with a different email"
        actions={
          <SignOutAndReturn returnTo={`/accept-invitation/${id}`}>
            Sign out
          </SignOutAndReturn>
        }
      >
        Sign out, then sign in with the invited email address.
      </AuthResult>
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
  if (error) {
    return (
      <AuthResult
        tone="error"
        title="This invitation can't be used"
        footer={<AuthLink href="/login">Back to login</AuthLink>}
      >
        {error}
      </AuthResult>
    );
  }

  return (
    <div className="w-full max-w-[400px] mx-auto">
      <div className="mb-32 text-center">
        <h1 className="title-heading-2 mb-16">Join organization</h1>
        <p className="body-medium text-[var(--color-text-secondary)]">
          You&apos;ve been invited to collaborate.
        </p>
      </div>
      <div className="bg-[var(--color-background-white)] border border-[var(--color-border-primary)] p-32 shadow-sm">
        {children}
      </div>
    </div>
  );
}
