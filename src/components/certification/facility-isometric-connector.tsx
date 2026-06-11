/**
 * FacilityIsometricConnector
 * Lightweight inline registry connector for the facility edit form: shows the
 * facility's Isometric link status and lets an admin pick a project and
 * connect in place. Deliberately minimal — only the project link
 * (`externalProjectId`) is editable here; template / facility-id / protocol
 * binding stays in Certification → Settings (linked in the header). Saving
 * goes through the same admin-gated `saveFacilityCertifierMapping` action as
 * the Settings dialog, so all server-side guards (project existence,
 * submission-pinned mappings, production confirm) apply unchanged.
 *
 * Renders nothing for non-admins: saving is admin-gated, and the heavier
 * management payload (available projects, link hints) must not be fetched
 * for viewers who can't act on it — they see the read-only
 * `FacilityCertifierSummary` in the facility view sheet instead.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { FormField, FormSelect, ServerError } from "@/components/forms";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  useFacilityCertifierMapping,
  useSaveFacilityCertifierMapping,
} from "@/hooks/use-certification";
import { isometricRegistry } from "@/lib/isometric/links";
import { EnvBanner } from "./env-banner";

// Carry the edited facility through to Settings — the facility side-sheet can
// show a facility other than the sidebar-selected one (same rationale as
// FacilityCertifierSummary).
const settingsHref = (facilityId: string) =>
  `/certification/settings?facility=${encodeURIComponent(facilityId)}`;

interface FacilityIsometricConnectorProps {
  facilityId: string;
}

export function FacilityIsometricConnector({
  facilityId,
}: FacilityIsometricConnectorProps) {
  const isAdmin = useIsAdmin();
  const { data, isLoading, error } = useFacilityCertifierMapping(
    facilityId,
    isAdmin,
  );
  const saveMutation = useSaveFacilityCertifierMapping();
  const toast = useToast();

  // null = untouched (select shows the currently-connected project).
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [acknowledgeSharedProject, setAcknowledgeSharedProject] =
    useState(false);
  const [confirmProduction, setConfirmProduction] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  if (!isAdmin) return null;

  const header = (
    <div className="flex items-center justify-between gap-12">
      <h3 className="title-chapter-title">Isometric Certify</h3>
      <Link
        href={settingsHref(facilityId)}
        className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
      >
        Advanced binding → Certification Settings ↗
      </Link>
    </div>
  );

  if (isLoading) {
    return (
      <ConnectorShell header={header}>
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading registry link…
        </p>
      </ConnectorShell>
    );
  }

  if (error || !data) {
    return (
      <ConnectorShell header={header}>
        <p className="body-small text-[var(--color-signal-red)]" role="alert">
          Unable to load the registry link
          {error instanceof Error ? `: ${error.message}` : "."}
        </p>
      </ConnectorShell>
    );
  }

  const { mapping, availableProjects, linkHints, isProduction, isConfigured } =
    data;

  if (!isConfigured) {
    return (
      <ConnectorShell header={header}>
        <FormField id="isometric-project" label="Isometric project">
          <FormSelect
            id="isometric-project"
            placeholder="Isometric not configured"
            options={[]}
            disabled
          />
        </FormField>
        <p className="body-small text-[var(--color-text-tertiary)]">
          Isometric isn&apos;t configured for this environment — registry
          connection is disabled until API credentials are set.
        </p>
      </ConnectorShell>
    );
  }

  const currentProjectId = mapping?.externalProjectId ?? "";
  const selected = selectedProjectId ?? currentProjectId;
  const isDirty = !!selected && selected !== currentProjectId;

  const connectedProjectName = mapping
    ? (availableProjects.find((p) => p.id === currentProjectId)?.name ?? null)
    : null;

  // Other facilities already linked to the selected project → sharing needs an
  // explicit opt-in before save (parity with FacilityCertifierDialog).
  const linkedElsewhere = isDirty
    ? (linkHints
        .find((hint) => hint.externalProjectId === selected)
        ?.linkedFacilities.filter((f) => f.facilityId !== facilityId)
        .map((f) => `${f.code} (${f.name})`) ?? [])
    : [];
  const requiresShareAck = linkedElsewhere.length > 0;

  // Connecting a different project clears the project-scoped registry
  // identifiers (a stale template or fcl_ id would point at the wrong
  // project) — warn when the current mapping carries them.
  const clearsAdvancedBinding =
    isDirty &&
    !!mapping &&
    !!(mapping.defaultRemovalTemplateId || mapping.externalFacilityId);

  const projectOptions = availableProjects.map((project) => ({
    value: project.id,
    label: `${project.name} — ${project.id}`,
  }));

  const connectBlocked =
    !isDirty ||
    (requiresShareAck && !acknowledgeSharedProject) ||
    (isProduction && !confirmProduction) ||
    saveMutation.isPending;

  const handleSelect = (value: string) => {
    setSelectedProjectId(value);
    setAcknowledgeSharedProject(false);
    setServerError(null);
  };

  const handleConnect = async () => {
    setServerError(null);
    try {
      await saveMutation.mutateAsync({
        facilityId,
        externalProjectId: selected,
        protocolSlug: mapping?.protocolSlug ?? "biochar",
        defaultRemovalTemplateId: null,
        externalFacilityId: null,
        confirmProduction,
      });
      toast.success(
        mapping ? "Isometric project updated" : "Isometric project connected",
      );
      setSelectedProjectId(null);
      setAcknowledgeSharedProject(false);
      setConfirmProduction(false);
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : "Failed to connect project",
      );
    }
  };

  return (
    <ConnectorShell header={header}>
      {mapping ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          Connected to{" "}
          <span className="text-[var(--color-text-primary)] font-semibold">
            {connectedProjectName ?? currentProjectId}
          </span>{" "}
          ·{" "}
          <a
            href={isometricRegistry.project(currentProjectId)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-[var(--color-text-primary)]"
          >
            View on Isometric ↗
          </a>
        </p>
      ) : (
        <p className="body-small text-[var(--color-text-secondary)]">
          Not connected — submissions from this facility are blocked until an
          Isometric project is linked.
        </p>
      )}

      {serverError && <ServerError message={serverError} />}

      {availableProjects.length === 0 ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          No projects found on Isometric for this account.
        </p>
      ) : (
        <div className="flex items-end gap-12">
          <div className="flex-1">
            <FormField id="isometric-project" label="Isometric project">
              <FormSelect
                id="isometric-project"
                placeholder="Select a project"
                options={projectOptions}
                value={selected}
                onChange={(event) => handleSelect(event.target.value)}
                disabled={saveMutation.isPending}
              />
            </FormField>
          </div>
          <Button
            type="button"
            variant="default"
            onClick={handleConnect}
            disabled={connectBlocked}
          >
            {saveMutation.isPending
              ? "Connecting…"
              : mapping
                ? "Update link"
                : "Connect"}
          </Button>
        </div>
      )}

      {clearsAdvancedBinding && (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Changing the project clears the default removal template and
          Isometric facility ID — rebind them in Certification → Settings.
        </p>
      )}

      {requiresShareAck && (
        <div className="flex flex-col gap-12 border border-[var(--color-signal-amber)] bg-[var(--color-signal-amber-subtle)] p-16">
          <p className="body-small text-[var(--color-text-primary)]">
            This project is already linked to{" "}
            <strong className="font-semibold">
              {linkedElsewhere.join(", ")}
            </strong>
            . Submissions from both facilities will target the same Isometric
            project.
          </p>
          <label className="flex items-start gap-12 body-small text-[var(--color-text-primary)] cursor-pointer">
            <input
              type="checkbox"
              className="mt-3 shrink-0"
              checked={acknowledgeSharedProject}
              onChange={(event) =>
                setAcknowledgeSharedProject(event.target.checked)
              }
            />
            <span>I intend to share this project across facilities.</span>
          </label>
        </div>
      )}

      {isProduction && isDirty && (
        <div className="flex flex-col gap-12">
          <EnvBanner isProduction variant="inline" />
          <label className="flex items-start gap-12 body-small text-[var(--color-text-primary)] cursor-pointer">
            <input
              type="checkbox"
              className="mt-3 shrink-0"
              checked={confirmProduction}
              onChange={(event) => setConfirmProduction(event.target.checked)}
            />
            <span>
              I understand this links the facility to the{" "}
              <strong className="font-semibold">production</strong> Isometric
              registry. Future submissions from this facility will use
              production.
            </span>
          </label>
        </div>
      )}
    </ConnectorShell>
  );
}

function ConnectorShell({
  header,
  children,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-16 border-t border-[var(--color-border-secondary)] pt-20">
      {header}
      {children}
    </div>
  );
}
