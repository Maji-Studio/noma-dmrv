"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useSetOrganizationApiAccess } from "@/hooks/use-organizations";

interface PlatformOrganizationApiAccessProps {
  organizationId: string;
  organizationName: string;
  enabled: boolean;
}

/**
 * API access for one organization on the Platform page. Turning it on is
 * immediate; turning it off stops every API key, so it asks first.
 */
export function PlatformOrganizationApiAccess({ organizationId, organizationName, enabled }: PlatformOrganizationApiAccessProps) {
  const toast = useToast();
  const mutation = useSetOrganizationApiAccess();
  const [confirmOff, setConfirmOff] = useState(false);
  const titleId = `org-api-access-title-${organizationId}`;

  async function setApiAccess(next: boolean) {
    try {
      await mutation.mutateAsync({ id: organizationId, enabled: next });
      setConfirmOff(false);
      toast.success(`API access turned ${next ? "on" : "off"} for ${organizationName}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "API access was not changed. Try again.");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-12">
        <p className="body-small">
          {enabled ? "On. The organization's API keys work." : "Off. The organization's API keys do not work."}
        </p>
        <Button
          type="button"
          variant="weak"
          size="small"
          busy={mutation.isPending}
          onClick={() => (enabled ? setConfirmOff(true) : setApiAccess(true))}
        >
          {enabled ? "Turn API access off" : "Turn API access on"}
        </Button>
      </div>
      <Modal
        isOpen={confirmOff}
        onClose={() => setConfirmOff(false)}
        dismissible={!mutation.isPending}
        dismissOnClickOutside={!mutation.isPending}
        ariaLabelledBy={titleId}
        width="sm"
      >
        <div className="flex flex-col gap-16">
          <h2 id={titleId} className="title-heading-3">Turn API access off for {organizationName}?</h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            Every API key in this organization stops working until API access is turned back on.
            The API keys are not revoked.
          </p>
          <div className="flex flex-wrap justify-start gap-8">
            <Button type="button" busy={mutation.isPending} onClick={() => setApiAccess(false)}>
              Turn API access off
            </Button>
            <Button type="button" variant="weak" disabled={mutation.isPending} onClick={() => setConfirmOff(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
