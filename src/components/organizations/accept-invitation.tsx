/**
 * AcceptInvitation — the invitee's confirm step. The signed-in user's email
 * must match the invite (enforced server-side by the plugin). On success we
 * switch into the org and land on the dashboard.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useBusyUntilUnload } from "@/hooks/use-busy-until-unload";
import { acceptInvitationAction } from "@/fn/organizations";
import { useResetAfterOrgSwitch } from "@/hooks/use-organizations";
import { Notice } from "@/components/ui/notice";

export function AcceptInvitation({
  invitationId,
  userEmail,
}: {
  invitationId: string;
  userEmail: string;
}) {
  const resetAfterOrgSwitch = useResetAfterOrgSwitch();
  // Busy from the click until the page reloads into the new organization; only a failure clears it.
  const busy = useBusyUntilUnload();
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    busy.hold(true);
    setError(null);
    try {
      const result = await acceptInvitationAction({ invitationId });
      if (!result.success) {
        busy.release();
        setError(result.error);
        return;
      }
      // Accepted and switched. A warning says only that the organization was
      // not remembered as the default, so it travels with the reload.
      resetAfterOrgSwitch(result.warning);
    } catch {
      // Rejected request (network/server): don't leave the button stuck.
      busy.release();
      setError("The invitation was not accepted. Check your connection and try again.");
    }
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
        <Notice tone="error">{error}</Notice>
      )}
      <Button
        type="button"
        variant="primary"
        width="full"
        onClick={accept}
        busy={!!busy.held}
      >
        Accept invitation
      </Button>
    </div>
  );
}
