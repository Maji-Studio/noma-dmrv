/**
 * RegistryStatusLine — which registry the organization certifies with, and
 * whether the connection works (Q8). It replaced a row of registry cards with
 * two "Coming soon" placeholders: there is one registry, so the choice is a
 * line of text, and the status is the part worth reading.
 *
 * The status says only what is known:
 *  - Keys not saved: the organization has no Isometric keys.
 *  - Connected: Isometric listed projects with the saved keys just now.
 *  - Connection failing: the saved keys cannot be used to reach Isometric
 *    (the read answered "not configured" or Isometric rejected the keys).
 *  - Not checked: the check itself failed (network, a 5xx, a rate limit). That
 *    says nothing about the keys, so it asks for nothing.
 *  - Keys saved: saved, not checked here (members, or no facility to check
 *    with), so it is not called connected.
 *
 * The connection check reuses the facility mapping read the Facilities pane
 * and the project picker already make, so it is a cache hit there; it is only
 * made for viewers who may manage the link.
 */
"use client";

import type { Icon } from "@phosphor-icons/react";
import {
  CheckCircleIcon,
  CircleIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useFacilityCertifierMapping } from "@/hooks/use-certification";
import { useOrgCertifierCredentialsStatus } from "@/hooks/use-certifier-credentials";
import { ORGANIZATION_SETTINGS_ROLES } from "@/lib/settings/panes";
import { isActionError } from "@/lib/action-error";

export const REGISTRY_NAME = "Isometric";

export type RegistryConnectionStatus =
  | "keys-not-saved"
  | "keys-saved"
  | "connected"
  | "failing"
  | "unchecked";

interface StatusCopy {
  title: string;
  detail?: string;
  icon: Icon;
  colorClass: string;
}

export function registryStatusCopy(
  status: RegistryConnectionStatus,
  canManage: boolean,
): StatusCopy {
  switch (status) {
    case "keys-not-saved":
      return {
        title: "Keys not saved.",
        detail: canManage
          ? `Save the ${REGISTRY_NAME} keys below to connect.`
          : `${ORGANIZATION_SETTINGS_ROLES} save the ${REGISTRY_NAME} keys here.`,
        icon: WarningIcon,
        colorClass: "text-[var(--st-wait)]",
      };
    case "failing":
      return {
        title: "Connection failing.",
        detail: canManage
          ? `The saved keys cannot be used to reach ${REGISTRY_NAME}. Replace them below.`
          : `The saved keys cannot be used to reach ${REGISTRY_NAME}.`,
        icon: WarningCircleIcon,
        colorClass: "text-[var(--st-bad)]",
      };
    case "unchecked":
      return {
        title: "Couldn't check the connection right now.",
        detail: "Refresh the page to try again.",
        icon: CircleIcon,
        colorClass: "text-[var(--st-off)]",
      };
    case "connected":
      return {
        title: "Connected.",
        icon: CheckCircleIcon,
        colorClass: "text-[var(--st-ok)]",
      };
    case "keys-saved":
      return {
        title: "Keys saved.",
        icon: CircleIcon,
        colorClass: "text-[var(--st-off)]",
      };
  }
}

/**
 * The status this viewer can know. `keysSavedFallback` is the server's answer
 * for viewers who cannot read the credential status themselves.
 */
export function useRegistryConnectionStatus({
  organizationId,
  facilityId,
  canManage,
  keysSavedFallback,
}: {
  organizationId: string | null | undefined;
  facilityId: string | null | undefined;
  canManage: boolean;
  keysSavedFallback?: boolean;
}): RegistryConnectionStatus | null {
  const credentials = useOrgCertifierCredentialsStatus(organizationId ?? "", canManage);
  const keysSaved = canManage ? credentials.data?.configured : keysSavedFallback;
  const mapping = useFacilityCertifierMapping(
    facilityId ?? "",
    canManage && keysSaved === true && !!facilityId,
  );

  if (keysSaved === undefined) return null;
  if (!keysSaved) return "keys-not-saved";
  if (!canManage || !facilityId || mapping.isLoading) return "keys-saved";
  if (mapping.error) {
    return isActionError(mapping.error) && mapping.error.code === "registry_read_refused"
      ? "failing"
      : "unchecked";
  }
  if (mapping.data) return mapping.data.isConfigured ? "connected" : "failing";
  return "keys-saved";
}

export function RegistryStatusLine({
  status,
  canManage,
}: {
  status: RegistryConnectionStatus | null;
  canManage: boolean;
}) {
  const copy = status ? registryStatusCopy(status, canManage) : null;
  const StatusIcon = copy?.icon;

  return (
    <div className="flex flex-col gap-8">
      <p className="body-medium">
        Registry: <span className="font-medium">{REGISTRY_NAME}</span>
      </p>
      {copy && StatusIcon && (
        <p className="body-small flex items-start gap-8" role="status">
          <StatusIcon
            size={16}
            weight="fill"
            aria-hidden
            className={`mt-2 shrink-0 ${copy.colorClass}`}
          />
          <span>
            <span className="font-medium">{copy.title}</span>
            {copy.detail ? ` ${copy.detail}` : null}
          </span>
        </p>
      )}
    </div>
  );
}
