/**
 * Accept-invitation landing page. Requires a signed-in session whose email
 * matches the invite (the plugin enforces the match on accept). Unauthenticated
 * visitors are sent to sign in and returned here.
 */
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/server";
import { AcceptInvitation } from "@/components/organizations/accept-invitation";

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getUser();
  if (!user) {
    redirect(`/login?from=${encodeURIComponent(`/accept-invitation/${id}`)}`);
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
        <AcceptInvitation invitationId={id} userEmail={user.email} />
      </div>
    </div>
  );
}
