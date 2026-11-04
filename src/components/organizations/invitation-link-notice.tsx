/**
 * InvitationLinkNotice: what an Admin sees right after an invitation is saved.
 * One notice for both places that create one (Settings, Members and the
 * Platform Organizations create flow). The invitation is always kept; the
 * notice says whether the email went out, and the accept link stays copyable
 * either way so the Admin can send it another way.
 */
"use client";

import { useState } from "react";
import { CheckCircleIcon, CopyIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";

export interface InvitationDelivery {
  email: string;
  acceptUrl: string;
  /** True when the provider accepted the email; false when it was not sent. */
  emailSent: boolean;
}

export function InvitationLinkNotice({ invitation }: { invitation: InvitationDelivery }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(invitation.acceptUrl);
      setCopied(true);
      toast.success("Invitation link copied.");
    } catch {
      toast.error("The invitation link was not copied. Select and copy it manually.");
    }
  }

  return (
    <Notice
      tone={invitation.emailSent ? "success" : "warning"}
      title={
        invitation.emailSent
          ? `Invitation emailed to ${invitation.email}`
          : `The email to ${invitation.email} did not send`
      }
    >
      {!invitation.emailSent &&
        "The invitation is saved. Copy the link and send it another way, or check the address."}
      <div className="mt-8 flex items-center gap-8">
        <input
          readOnly
          aria-label="Invitation link"
          value={invitation.acceptUrl}
          onFocus={(event) => event.currentTarget.select()}
          className="body-caption min-w-0 flex-1 border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-8 py-6 font-mono"
        />
        <Button type="button" variant="weak" size="small" onClick={copy}>
          {copied ? <CheckCircleIcon size={16} weight="fill" /> : <CopyIcon size={16} />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </Notice>
  );
}
