/**
 * AcceptInvitation — the invitee's confirm step. The signed-in user's email
 * must match the invite (enforced server-side by the plugin). On success we
 * switch into the org and land on the dashboard.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction } from "@/fn/organizations";
import { useResetAfterOrgSwitch } from "@/hooks/use-organizations";

export function AcceptInvitation({
  invitationId,
  userEmail,
}: {
  invitationId: string;
  userEmail: string;
}) {
  const resetAfterOrgSwitch = useResetAfterOrgSwitch();
  const [status, setStatus] = useState<"idle" | "accepting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setStatus("accepting");
    setError(null);
    const result = await acceptInvitationAction({ invitationId });
    if (!result.success) {
      setStatus("error");
      setError(result.error);
      return;
    }
    resetAfterOrgSwitch();
  }

  return (
    <div className="flex flex-col gap-16">
      <p className="body-medium text-[var(--color-text-secondary)]">
        You&apos;re signed in as{" "}
        <span className="font-medium text-[var(--color-text-primary)]">
          {userEmail}
        </span>
        . Accept the invitation to join the organization.
      </p>
      {error && (
        <p className="body-small text-[var(--st-bad)] border border-[var(--st-bad-border)] bg-[var(--st-bad-bg)] p-12">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="primary"
        width="full"
        onClick={accept}
        disabled={status === "accepting"}
      >
        {status === "accepting" ? "Accepting…" : "Accept invitation"}
      </Button>
    </div>
  );
}
