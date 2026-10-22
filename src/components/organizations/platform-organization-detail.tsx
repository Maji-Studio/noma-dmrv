"use client";

import { useState } from "react";
import { ArrowRightIcon, CheckCircleIcon, CopyIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { SETTINGS_MEMBERS_HREF } from "@/lib/settings/links";
import { OrganizationCertifierCredentials } from "./organization-certifier-credentials";
import { PlatformOrganizationApiAccess } from "./platform-organization-api-access";
import { adminsLabel, membersLabel, type PlatformOrganization } from "./platform-organization-rows";

interface PlatformOrganizationDetailProps {
  organization: PlatformOrganization;
  /** True for the organization the viewer is working in now. */
  current: boolean;
  /** Which control a switch in flight belongs to: this panel's Switch, its Manage members, or another organization. */
  switching: "switch" | "members" | "other" | null;
  onSwitch: (landingHref?: string) => void;
  /** The invitation link for a first Admin who had no account, right after create. */
  invitation: { email: string; acceptUrl: string } | null;
}

/**
 * Everything a Platform Admin does to one organization: switch into it, its
 * Isometric keys, its API access, and a way to its members. Members are
 * managed in that organization's Settings, Members, so the link switches first
 * when it is not the current one.
 */
export function PlatformOrganizationDetail({ organization, current, switching, onSwitch, invitation }: PlatformOrganizationDetailProps) {
  const { id, name, memberCount, adminCount, isometricKeysSaved, apiAccessEnabled } = organization;
  const anySwitching = switching !== null;
  const membersAction = memberCount === 0 ? "Invite members" : "Manage members";

  return (
    <article aria-label={name} className="flex flex-col border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
      <header className="flex flex-wrap items-center justify-between gap-16 border-b border-[var(--color-border-secondary)] p-24">
        <div className="flex min-w-0 flex-col gap-4">
          <h2 className="title-heading-3 break-words">{name}</h2>
        </div>
        {current ? (
          <span className="body-small flex items-center gap-6 text-[var(--color-text-secondary)]">
            <CheckCircleIcon size={18} className="shrink-0 text-[var(--st-ok)]" aria-hidden />
            You&apos;re working in {name}.
          </span>
        ) : (
          <Button
            type="button"
            variant="primary"
            busy={switching === "switch"}
            disabled={anySwitching && switching !== "switch"}
            onClick={() => onSwitch()}
          >
            Switch to {name}
          </Button>
        )}
      </header>

      {invitation && <FirstAdminInvitation invitation={invitation} />}

      <section aria-labelledby={`org-keys-${id}`} className="flex flex-col gap-12 border-b border-[var(--color-border-secondary)] p-24">
        <div className="flex flex-wrap items-center justify-between gap-12">
          <h3 id={`org-keys-${id}`} className="title-chapter-title text-[var(--color-text-tertiary)]">Isometric keys</h3>
          <StatusBadge status={isometricKeysSaved ? "ready" : "draft"} label={isometricKeysSaved ? "Saved" : "Missing"} />
        </div>
        <div className="content-measure-form">
          <OrganizationCertifierCredentials organizationId={id} organizationName={name} />
        </div>
      </section>

      <section aria-labelledby={`org-api-${id}`} className="flex flex-col gap-12 border-b border-[var(--color-border-secondary)] p-24">
        <h3 id={`org-api-${id}`} className="title-chapter-title text-[var(--color-text-tertiary)]">API access</h3>
        <PlatformOrganizationApiAccess organizationId={id} organizationName={name} enabled={apiAccessEnabled} />
      </section>

      <section aria-labelledby={`org-members-${id}`} className="flex flex-col gap-8 p-24">
        <h3 id={`org-members-${id}`} className="title-chapter-title text-[var(--color-text-tertiary)]">Members</h3>
        <p className="body-small">
          {memberCount === 0
            ? "No members yet. Nobody can sign in to this organization."
            : `${membersLabel(memberCount)}, ${adminsLabel(adminCount)}`}
        </p>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="noOutline"
            size="small"
            busy={switching === "members"}
            disabled={anySwitching && switching !== "members"}
            onClick={() => onSwitch(SETTINGS_MEMBERS_HREF)}
            className="w-fit px-0 underline underline-offset-2"
          >
            {membersAction} <ArrowRightIcon size={14} aria-hidden />
          </Button>
          {!current && (
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Switches you to {name}, then opens Settings, Members.
            </span>
          )}
        </div>
      </section>
    </article>
  );
}

function FirstAdminInvitation({ invitation }: { invitation: { email: string; acceptUrl: string } }) {
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
    <div className="border-b border-[var(--color-border-secondary)] p-24">
      <Notice tone="success" title={`${invitation.email} has no account yet`}>
        Send them this link to join as Admin.
        <div className="mt-8 flex items-center gap-8">
          <input
            readOnly
            aria-label="Invitation link"
            value={invitation.acceptUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="body-caption min-w-0 flex-1 border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-8 py-6 font-mono"
          />
          <Button type="button" variant="weak" size="small" onClick={copy}>
            <CopyIcon size={14} aria-hidden /> {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Notice>
    </div>
  );
}
