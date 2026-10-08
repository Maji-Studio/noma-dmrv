"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { useOrgCertifierCredentialsStatus } from "@/hooks/use-certifier-credentials";
import { useSetOrganizationApiAccess } from "@/hooks/use-organizations";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { OrganizationCertifierCredentials } from "./organization-certifier-credentials";
import { OrganizationRosterRow } from "./organization-roster-list";

interface OrganizationAdminRowProps {
  org: { id: string; name: string; slug: string; memberCount: number };
  apiAccessEnabled: boolean | undefined;
  entering: boolean;
  onEnter: () => void;
}

/**
 * Organization status and actions, with confirmation before disabling API
 * access and a write-only certifier keys form in its own modal.
 */
export function OrganizationAdminRow({ org, apiAccessEnabled, entering, onEnter }: OrganizationAdminRowProps) {
  const [keysOpen, setKeysOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const apiAccess = useSetOrganizationApiAccess();
  const toast = useToast();
  const status = useOrgCertifierCredentialsStatus(org.id);
  const titleId = `org-keys-title-${org.id}`;

  async function setApiAccess(enabled: boolean) {
    try {
      await apiAccess.mutateAsync({ id: org.id, enabled });
      setConfirmOff(false);
      toast.success(`API access turned ${enabled ? "on" : "off"} for ${org.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "API access was not changed. Try again.");
    }
  }

  return (
    <>
      <OrganizationRosterRow
        primary={org.name}
        secondary={
          <>
            {org.slug} · {org.memberCount} member
            {org.memberCount === 1 ? "" : "s"}
          </>
        }
        actions={
          <>
            <StatusBadge
              status={apiAccessEnabled ? "ready" : "draft"}
              label={apiAccessEnabled === undefined ? `API access: ${MISSING_VALUE.notAvailable}` : `API access ${apiAccessEnabled ? "on" : "off"}`}
            />
            <Button
              type="button"
              variant="weak"
              size="small"
              disabled={apiAccessEnabled === undefined}
              busy={apiAccess.isPending}
              onClick={() => apiAccessEnabled ? setConfirmOff(true) : setApiAccess(true)}
            >
              {apiAccessEnabled === false ? "Turn API access on" : "Turn API access off"}
            </Button>
            {status.data && (
              <StatusBadge
                status={status.data.configured ? "ready" : "draft"}
                label={status.data.configured ? "Keys saved" : "No keys"}
              />
            )}
            <Button
              type="button"
              variant="weak"
              size="small"
              onClick={() => setKeysOpen(true)}
            >
              Isometric keys
            </Button>
            <Button
              type="button"
              variant="weak"
              size="small"
              onClick={onEnter}
              busy={entering}
            >
              Enter
            </Button>
          </>
        }
      />
      <Modal
        isOpen={confirmOff}
        onClose={() => setConfirmOff(false)}
        dismissible={!apiAccess.isPending}
        dismissOnClickOutside={!apiAccess.isPending}
        ariaLabelledBy={`org-api-access-title-${org.id}`}
        width="sm"
      >
        <div className="flex flex-col gap-16">
          <h2 id={`org-api-access-title-${org.id}`} className="title-heading-3">
            Turn API access off for {org.name}?
          </h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            Every API key in this organization stops working until API access is turned back on.
            The API keys are not revoked.
          </p>
          <div className="flex justify-end gap-8">
            <Button type="button" variant="weak" disabled={apiAccess.isPending} onClick={() => setConfirmOff(false)}>
              Cancel
            </Button>
            <Button type="button" busy={apiAccess.isPending} onClick={() => setApiAccess(false)}>
              Turn API access off
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={keysOpen}
        onClose={() => setKeysOpen(false)}
        dismissible={!saving}
        dismissOnClickOutside={!saving}
        ariaLabelledBy={titleId}
        width="md"
      >
        <div className="flex flex-col gap-16">
          <h2 id={titleId} className="title-heading-3">
            Isometric keys for {org.name}
          </h2>
          <OrganizationCertifierCredentials
            organizationId={org.id}
            organizationName={org.name}
            onSavingChange={setSaving}
          />
        </div>
      </Modal>
    </>
  );
}
