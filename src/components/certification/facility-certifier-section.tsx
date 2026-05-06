/**
 * FacilityCertifierSection
 * View-mode card that surfaces a facility's Isometric project mapping inside
 * the facility EntitySideSheet. Linked: shows project + template + actions.
 * Not linked: shows a single CTA to open the link dialog.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  useDeleteFacilityCertifierMapping,
  useFacilityCertifierMapping,
} from "@/hooks/use-certification";
import {
  FacilityCertifierDialog,
  UnlinkConfirmDialog,
} from "./facility-certifier-dialog";
import { Field, Section } from "./panel-layout";

interface FacilityCertifierSectionProps {
  facilityId: string;
}

export function FacilityCertifierSection({
  facilityId,
}: FacilityCertifierSectionProps) {
  const { data, isLoading, error } =
    useFacilityCertifierMapping(facilityId);
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
      setUnlinkError(
        err instanceof Error ? err.message : "Failed to unlink",
      );
    }
  };

  if (isLoading) {
    return (
      <Section>
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading certifier mapping…
        </p>
      </Section>
    );
  }

  if (error || !data) {
    return (
      <Section>
        <p className="body-small text-[var(--color-signal-red)]">
          Failed to load certifier mapping
          {error instanceof Error ? `: ${error.message}` : "."}
        </p>
      </Section>
    );
  }

  const { mapping, isProduction } = data;

  return (
    <>
      <Section>
        <header className="flex items-center justify-between gap-12">
          <div className="flex flex-col gap-4">
            <h3 className="title-chapter-title">Certification</h3>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Isometric · {isProduction ? "production" : "sandbox"}
            </p>
          </div>
          {mapping ? (
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
          )}
        </header>

        {mapping && (
          <dl className="grid grid-cols-2 gap-x-16 gap-y-12 mt-16">
            <Field label="Project">
              <span className="body-small">
                {projectName ?? "—"}
              </span>
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {mapping.externalProjectId}
              </span>
            </Field>
            <Field label="Default removal template">
              <span className="body-small">
                {templateName ?? (mapping.defaultRemovalTemplateId ? "—" : "Not set")}
              </span>
              {mapping.defaultRemovalTemplateId && (
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  {mapping.defaultRemovalTemplateId}
                </span>
              )}
            </Field>
            <Field label="Protocol">
              <span className="body-small">
                {mapping.protocolSlug}
                {mapping.protocolVersion ? ` ${mapping.protocolVersion}` : ""}
              </span>
            </Field>
            <Field label="Linked at">
              <span className="body-small">
                {new Date(mapping.createdAt).toLocaleDateString()}
              </span>
            </Field>
          </dl>
        )}

        {!mapping && (
          <p className="body-small text-[var(--color-text-secondary)] mt-16">
            This facility has no Isometric project link yet. Submissions
            from this facility will be blocked until you link one.
          </p>
        )}
      </Section>

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

