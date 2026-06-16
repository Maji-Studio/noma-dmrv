/**
 * FacilityCertifierSection
 * Surfaces a facility's Isometric project mapping. Two modes, gated by the
 * required `canManage` prop:
 *  - manage: full management view — Edit / Unlink / Link controls backed by the
 *    heavier management loader (available projects, templates, and
 *    cross-facility link hints from the Isometric API).
 *  - read-only: a DB-only summary (no management payload on the wire) with no
 *    controls — for viewers who can read the current link but not change it.
 * Mounts in /certification/settings (passing `canManage={isAdmin}`). The
 * facility side-sheet shows the lighter `FacilityCertifierSummary` instead.
 */
"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  useDeleteFacilityCertifierMapping,
  useFacilityCertifierMapping,
  useFacilityCertifierSummary,
} from "@/hooks/use-certification";
import { isometricRegistry } from "@/lib/isometric/links";
import type { CertifierProjectRow } from "@/data-access/certification";
import {
  FacilityCertifierDialog,
  UnlinkConfirmDialog,
} from "./facility-certifier-dialog";
import { Field, Section } from "./panel-layout";

interface FacilityCertifierSectionProps {
  facilityId: string;
  /**
   * Whether the viewer can change the link. Gates BOTH the management controls
   * and the heavier management loader — when false, only the read-only summary
   * is fetched (the available-project list, template options, and link hints
   * never reach a non-managing viewer). Required: every caller makes the
   * read-vs-manage choice explicitly (Settings passes `isAdmin`).
   */
  canManage: boolean;
  /**
   * Drop the section's own border-top wrapper and "Certification" title when
   * the host already provides a titled card (e.g. the Settings "Registry
   * connection — Isometric" card). Management actions still render.
   */
  embedded?: boolean;
}

export function FacilityCertifierSection({
  facilityId,
  canManage,
  embedded = false,
}: FacilityCertifierSectionProps) {
  return canManage ? (
    <FacilityCertifierManage facilityId={facilityId} embedded={embedded} />
  ) : (
    <FacilityCertifierReadOnly facilityId={facilityId} embedded={embedded} />
  );
}

// `<Section>` (border-top divider) standalone; a plain block when embedded in a
// host card that already supplies its own header + padding.
function Shell({
  embedded,
  children,
}: {
  embedded: boolean;
  children: ReactNode;
}) {
  if (embedded) return <div className="flex flex-col">{children}</div>;
  return <Section>{children}</Section>;
}

function CertifierHeader({
  isProduction,
  actions,
  embedded,
}: {
  isProduction: boolean;
  actions?: ReactNode;
  embedded: boolean;
}) {
  if (embedded) {
    return actions ? (
      <div className="flex justify-end gap-12">{actions}</div>
    ) : null;
  }
  return (
    <header className="flex items-center justify-between gap-12">
      <div className="flex flex-col gap-4">
        <h3 className="title-chapter-title">Certification</h3>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Isometric · {isProduction ? "production" : "sandbox"}
        </p>
      </div>
      {actions}
    </header>
  );
}

/**
 * The mapping fields grid, shared by both modes. When `projectName` is
 * `undefined` the friendly name is unavailable (read-only path, which doesn't
 * fetch the project list) so the persisted identifiers stand in for it.
 */
function CertifierMappingFields({
  mapping,
  isProduction,
  projectName,
  templateName,
}: {
  mapping: CertifierProjectRow;
  isProduction: boolean;
  projectName?: string | null;
  templateName?: string | null;
}) {
  const resolvesNames = projectName !== undefined;

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-12 mt-16">
      <Field label="Project">
        {resolvesNames && (
          <span className="body-small">{projectName ?? "—"}</span>
        )}
        <span
          className={
            resolvesNames
              ? "body-caption text-[var(--color-text-tertiary)]"
              : "body-small font-mono"
          }
        >
          {mapping.externalProjectId}
        </span>
        <a
          href={isometricRegistry.certifyProject({
            environment: isProduction ? "production" : "sandbox",
            externalProjectId: mapping.externalProjectId,
          })}
          target="_blank"
          rel="noopener noreferrer"
          className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
        >
          View on Isometric ↗
        </a>
      </Field>
      <Field label="Default removal template">
        {resolvesNames ? (
          <>
            <span className="body-small">
              {templateName ??
                (mapping.defaultRemovalTemplateId ? "—" : "Not set")}
            </span>
            {mapping.defaultRemovalTemplateId && (
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {mapping.defaultRemovalTemplateId}
              </span>
            )}
          </>
        ) : (
          <span
            className={
              mapping.defaultRemovalTemplateId
                ? "body-small font-mono"
                : "body-small text-[var(--color-text-tertiary)]"
            }
          >
            {mapping.defaultRemovalTemplateId ?? "Not set"}
          </span>
        )}
      </Field>
      <Field label="Linked at">
        <span className="body-small">
          {new Date(mapping.createdAt).toLocaleDateString()}
        </span>
      </Field>
      <Field label="Isometric facility (telemetry)">
        {mapping.externalFacilityId ? (
          <span className="body-small font-mono">
            {mapping.externalFacilityId}
          </span>
        ) : (
          <span className="body-small text-[var(--color-text-tertiary)]">
            Not set — telemetry submission disabled
          </span>
        )}
      </Field>
    </dl>
  );
}

// Read-only mode: DB-only summary, no controls, no management payload fetched.
function FacilityCertifierReadOnly({
  facilityId,
  embedded,
}: {
  facilityId: string;
  embedded: boolean;
}) {
  const { data, isLoading, error } = useFacilityCertifierSummary(facilityId);

  if (isLoading) {
    return (
      <Shell embedded={embedded}>
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading certifier mapping…
        </p>
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell embedded={embedded}>
        <p className="body-small text-[var(--color-signal-red)]">
          Failed to load certifier mapping
          {error instanceof Error ? `: ${error.message}` : "."}
        </p>
      </Shell>
    );
  }

  const { mapping, isProduction } = data;

  return (
    <Shell embedded={embedded}>
      <CertifierHeader isProduction={isProduction} embedded={embedded} />
      {mapping ? (
        <CertifierMappingFields mapping={mapping} isProduction={isProduction} />
      ) : (
        <p className="body-small text-[var(--color-text-secondary)] mt-16">
          This facility has no Isometric project link yet. Ask an admin to link
          one — submissions from this facility are blocked until it is.
        </p>
      )}
    </Shell>
  );
}

// Management mode: full payload + Edit / Unlink / Link controls.
function FacilityCertifierManage({
  facilityId,
  embedded,
}: {
  facilityId: string;
  embedded: boolean;
}) {
  const { data, isLoading, error } = useFacilityCertifierMapping(facilityId);
  const [editOpen, setEditOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | undefined>();

  const toast = useToast();
  const deleteMutation = useDeleteFacilityCertifierMapping();

  const projectName = data?.mapping
    ? (data.availableProjects.find(
        (p) => p.id === data.mapping?.externalProjectId,
      )?.name ?? null)
    : null;

  const templateName = data?.mapping?.defaultRemovalTemplateId
    ? (data.availableTemplates.find(
        (t) => t.id === data.mapping?.defaultRemovalTemplateId,
      )?.display_name ?? null)
    : null;

  const handleUnlinkConfirm = async () => {
    setUnlinkError(undefined);
    try {
      await deleteMutation.mutateAsync(facilityId);
      toast.success("Certifier mapping removed");
      setUnlinkOpen(false);
    } catch (err) {
      setUnlinkError(err instanceof Error ? err.message : "Failed to unlink");
    }
  };

  if (isLoading) {
    return (
      <Shell embedded={embedded}>
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading certifier mapping…
        </p>
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell embedded={embedded}>
        <p className="body-small text-[var(--color-signal-red)]">
          Failed to load certifier mapping
          {error instanceof Error ? `: ${error.message}` : "."}
        </p>
      </Shell>
    );
  }

  const { mapping, isProduction } = data;

  return (
    <>
      <Shell embedded={embedded}>
        <CertifierHeader
          isProduction={isProduction}
          embedded={embedded}
          actions={
            mapping ? (
              <div className="flex gap-12">
                <Button
                  variant="default"
                  size="small"
                  onClick={() => setEditOpen(true)}
                >
                  Edit
                </Button>
                <Button
                  variant="default"
                  size="small"
                  onClick={() => setUnlinkOpen(true)}
                >
                  Unlink
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                size="small"
                onClick={() => setEditOpen(true)}
              >
                Link Isometric project
              </Button>
            )
          }
        />

        {mapping ? (
          <CertifierMappingFields
            mapping={mapping}
            isProduction={isProduction}
            projectName={projectName}
            templateName={templateName}
          />
        ) : (
          <p className="body-small text-[var(--color-text-secondary)] mt-16">
            This facility has no Isometric project link yet. Submissions from
            this facility will be blocked until you link one.
          </p>
        )}
      </Shell>

      {editOpen && (
        <FacilityCertifierDialog
          isOpen={editOpen}
          onClose={() => setEditOpen(false)}
          facilityId={facilityId}
          loaderData={data}
        />
      )}

      <UnlinkConfirmDialog
        isOpen={unlinkOpen}
        onClose={() => {
          setUnlinkOpen(false);
          setUnlinkError(undefined);
        }}
        onConfirm={handleUnlinkConfirm}
        isPending={deleteMutation.isPending}
        errorMessage={unlinkError}
      />
    </>
  );
}
