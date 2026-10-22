/**
 * FacilityCertifierSection
 * Surfaces a facility's Isometric project mapping. Two modes, gated by the
 * required `canManage` prop:
 *  - manage: full management view — Edit / Unlink / Link controls backed by the
 *    heavier management loader (available projects, templates, and
 *    cross-facility link hints from the Isometric API).
 *  - read-only: a DB-only summary (no management payload on the wire) with no
 *    controls — for viewers who can read the current link but not change it.
 * Mounts in Settings, Facilities, which passes the server-computed
 * `viewerCanManage`. The facility side-sheet shows the lighter
 * `FacilityCertifierSummary` instead.
 */
"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  useDeleteFacilityCertifierMapping,
  useFacilityCertifierMapping,
  useFacilityCertifierSummary,
} from "@/hooks/use-certification";
import { isometricRegistry } from "@/lib/isometric/links";
import { removalTemplatesSettingsHref } from "@/lib/certification/links";
import { formatDate } from "@/lib/format-utils";
import { MISSING_VALUE, NOT_FOUND_ON_ISOMETRIC } from "@/lib/copy-utils";
import type { CertifierProjectRow } from "@/data-access/certification";
import {
  FacilityCertifierDialog,
  FacilityCertifierForm,
  UnlinkConfirmDialog,
} from "./facility-certifier-dialog";
import { Field, Section } from "./panel-layout";
import { QueryResultState } from "./query-result-state";

interface FacilityCertifierSectionProps {
  facilityId: string;
  /**
   * Whether the viewer can change the link. Gates BOTH the management controls
   * and the heavier management loader — when false, only the read-only summary
   * is fetched (the available-project list, template options, and link hints
   * never reach a non-managing viewer). Required: every caller makes the
   * read-vs-manage choice explicitly (Settings passes `viewerCanManage`).
   */
  canManage: boolean;
  /**
   * Drop the section's own border-top wrapper and "Certification" title when
   * the host already provides a titled block (the Certifier settings pane, the
   * dashboard registry dialog). Management actions still render, below
   * the content rather than in the header the host owns.
   */
  embedded?: boolean;
  /**
   * Show project linking directly in the host instead of opening a dialog.
   * Use inside an existing modal, such as the dashboard registry dialog.
   */
  linkPresentation?: "dialog" | "inline";
  onLinked?: () => void;
}

export function FacilityCertifierSection({
  facilityId,
  canManage,
  embedded = false,
  linkPresentation = "dialog",
  onLinked,
}: FacilityCertifierSectionProps) {
  return canManage ? (
    <FacilityCertifierManage
      facilityId={facilityId}
      embedded={embedded}
      linkPresentation={linkPresentation}
      onLinked={onLinked}
    />
  ) : (
    <FacilityCertifierReadOnly facilityId={facilityId} embedded={embedded} />
  );
}

// `<Section>` (border-top divider) standalone; a plain block when embedded in a
// host card that already supplies its own header + padding. The shell owns the
// rhythm between header, fields, and actions so no child carries its own top
// margin — an embedded mount has no header for such a margin to sit under.
function Shell({
  embedded,
  children,
}: {
  embedded: boolean;
  children: ReactNode;
}) {
  const stack = <div className="flex flex-col gap-16">{children}</div>;
  return embedded ? stack : <Section>{stack}</Section>;
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
  // Embedded, the host card already carries the title, so there is no header
  // row for actions to sit in. They render below the content instead (see
  // `CertifierActions`) — a right-aligned button floating above the sentence
  // that explains what it does read as chrome belonging to something else.
  if (embedded) return null;
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
 * The manage controls when the section is embedded in a host card: a left-
 * aligned row below the content, in the same reading order as a form's actions.
 */
function CertifierActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-12">{children}</div>;
}

/**
 * The mapping fields grid, shared by both modes. When `projectName` is
 * `undefined` the app has not looked the names up (the read-only path does not
 * fetch the project list, and without Isometric keys there is nothing to
 * fetch), so the persisted identifiers stand in for them. `null` means a
 * configured lookup ran and did not find the ID on Isometric.
 */
function CertifierMappingFields({
  facilityId,
  mapping,
  isProduction,
  projectName,
  templateName,
}: {
  facilityId: string;
  mapping: CertifierProjectRow;
  isProduction: boolean;
  projectName?: string | null;
  templateName?: string | null;
}) {
  const resolvesNames = projectName !== undefined;

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-12">
      <Field label="Project">
        {resolvesNames && (
          <span className="body-small">
            {/* The saved project ID is not among Isometric's projects. */}
            {projectName ?? NOT_FOUND_ON_ISOMETRIC}
          </span>
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
      <Field label="Removal template">
        {resolvesNames ? (
          <>
            <span className="body-small">
              {templateName ??
                // A selected ID with no name is not among Isometric's templates; no ID means no relation was chosen.
                (mapping.removalTemplateId
                  ? NOT_FOUND_ON_ISOMETRIC
                  : MISSING_VALUE.notSet)}
            </span>
            {mapping.removalTemplateId && (
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {mapping.removalTemplateId}
              </span>
            )}
          </>
        ) : (
          <span
            className={
              mapping.removalTemplateId
                ? "body-small font-mono"
                : "body-small text-[var(--color-text-tertiary)]"
            }
          >
            {mapping.removalTemplateId ?? MISSING_VALUE.notSet}
          </span>
        )}
        {/* Chosen with its lines in Removal templates; shown here read-only. */}
        <Link
          href={removalTemplatesSettingsHref(facilityId)}
          className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
        >
          Open Removal templates
        </Link>
      </Field>
      <Field label="Linked at">
        <span className="body-small">
          {formatDate(mapping.createdAt)}
        </span>
      </Field>
      <Field label="Isometric facility">
        {mapping.externalFacilityId ? (
          <span className="body-small font-mono">
            {mapping.externalFacilityId}
          </span>
        ) : (
          <span className="body-small text-[var(--color-text-tertiary)]">
            {MISSING_VALUE.notSet}. Add the Isometric facility ID to register production batches.
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

  const shell = (children: ReactNode) => <Shell embedded={embedded}>{children}</Shell>;

  return (
    <QueryResultState
      isLoading={isLoading}
      error={error}
      data={data}
      loadingMessage="Loading certifier mapping…"
      errorMessage="The certifier mapping could not be loaded. Refresh the page and try again."
      wrap={shell}
    >
      {(data) => {
        const { mapping, isProduction } = data;

        return shell(
          <>
            <CertifierHeader isProduction={isProduction} embedded={embedded} />
            {mapping ? (
              <CertifierMappingFields facilityId={facilityId} mapping={mapping} isProduction={isProduction} />
            ) : (
              <p className="body-small text-[var(--color-text-secondary)]">
                This facility has no Isometric project link. Ask an Admin to link one
                before submitting from this facility.
              </p>
            )}
          </>,
        );
      }}
    </QueryResultState>
  );
}

// Management mode: full payload + Edit / Unlink / Link controls.
function FacilityCertifierManage({
  facilityId,
  embedded,
  linkPresentation,
  onLinked,
}: {
  facilityId: string;
  embedded: boolean;
  linkPresentation: "dialog" | "inline";
  onLinked?: () => void;
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

  const templateName = data?.mapping?.removalTemplateId
    ? (data.availableTemplates.find(
        (t) => t.id === data.mapping?.removalTemplateId,
      )?.display_name ?? null)
    : null;

  const handleUnlinkConfirm = async () => {
    setUnlinkError(undefined);
    try {
      await deleteMutation.mutateAsync(facilityId);
      toast.success("Certifier mapping removed");
      setUnlinkOpen(false);
    } catch (err) {
      setUnlinkError(
        err instanceof Error
          ? err.message
          : "The registry project was not unlinked. Try again.",
      );
    }
  };

  const shell = (children: ReactNode) => <Shell embedded={embedded}>{children}</Shell>;

  return (
    <QueryResultState
      isLoading={isLoading}
      error={error}
      data={data}
      loadingMessage="Loading certifier mapping…"
      errorMessage="The certifier mapping could not be loaded. Refresh the page and try again."
      wrap={shell}
    >
      {(data) => {
        const { mapping, isProduction } = data;
        const canOpenEdit =
          linkPresentation === "dialog" || data.isConfigured;

        const actions = mapping ? (
          <>
            {canOpenEdit && (
              <Button variant="default" size="small" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            )}
            {linkPresentation === "dialog" && (
              <Button
                variant="default"
                size="small"
                onClick={() => setUnlinkOpen(true)}
              >
                Unlink
              </Button>
            )}
          </>
        ) : linkPresentation === "dialog" ? (
          <Button variant="primary" size="small" onClick={() => setEditOpen(true)}>
            Link Isometric project
          </Button>
        ) : null;

        const showInlineForm =
          linkPresentation === "inline" &&
          data.isConfigured &&
          (!mapping || editOpen);

        return (
          <>
            {shell(
              <>
                <CertifierHeader
                  isProduction={isProduction}
                  embedded={embedded}
                  actions={
                    embedded ? undefined : (
                      <div className="flex gap-12">{actions}</div>
                    )
                  }
                />

                {showInlineForm ? (
                  <FacilityCertifierForm
                    facilityId={facilityId}
                    loaderData={data}
                    onSaved={() => {
                      setEditOpen(false);
                      onLinked?.();
                    }}
                    onCancel={mapping ? () => setEditOpen(false) : undefined}
                    presentation="inline"
                  />
                ) : mapping ? (
                  <CertifierMappingFields
                    facilityId={facilityId}
                    mapping={mapping}
                    isProduction={isProduction}
                    // Without Isometric keys the app never looked the IDs up,
                    // so it shows them as saved instead of claiming they are gone.
                    projectName={data.isConfigured ? projectName : undefined}
                    templateName={data.isConfigured ? templateName : undefined}
                  />
                ) : data.isConfigured ? (
                  <p className="body-small text-[var(--color-text-secondary)]">
                    This facility has no Isometric project link yet. Submissions from
                    this facility will be blocked until you link one.
                  </p>
                ) : (
                  <p className="body-small text-[var(--color-text-secondary)]">
                    Save valid Isometric keys above to load projects.
                  </p>
                )}

                {!showInlineForm && embedded && actions && (
                  <CertifierActions>{actions}</CertifierActions>
                )}
              </>,
            )}

            {linkPresentation === "dialog" && editOpen && (
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
      }}
    </QueryResultState>
  );
}
