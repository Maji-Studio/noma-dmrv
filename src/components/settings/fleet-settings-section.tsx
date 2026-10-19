/**
 * One list in Settings → Vehicles and crew: a heading with an add button, the
 * records in the settings roster style with Edit and Delete, and the delete
 * confirmation. The caller owns the data, the edit dialog and the delete
 * mutation, so the three lists share one shape.
 */
"use client";

import { useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ServerError } from "@/components/forms/server-error";
import {
  OrganizationRosterList,
  OrganizationRosterRow,
} from "@/components/organizations/organization-roster-list";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { toDeleteErrorMessage } from "@/lib/stale-version";

export interface FleetSectionProps<T extends { id: string }> {
  /** Section heading, e.g. "Vehicles". */
  title: string;
  /** Lowercase noun for buttons and copy, e.g. "vehicle". */
  noun: string;
  query: UseQueryResult<T[]>;
  emptyIcon: ReactNode;
  emptyDescription: string;
  primary: (record: T) => string;
  secondary: (record: T) => string | undefined;
  /** How the record is named in delete copy, e.g. "Vehicle VEH-001". */
  recordLabel: (record: T) => string;
  onAdd: () => void;
  onEdit: (record: T) => void;
  onDelete: (record: T) => Promise<unknown>;
  isDeleting: boolean;
}

export function FleetSettingsSection<T extends { id: string }>({
  title,
  noun,
  query,
  emptyIcon,
  emptyDescription,
  primary,
  secondary,
  recordLabel,
  onAdd,
  onEdit,
  onDelete,
  isDeleting,
}: FleetSectionProps<T>) {
  const toast = useToast();
  // Held by id and read from the list, so a stale refusal's list refresh
  // rebinds the confirmation to the row's new version for the next attempt.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleting = query.data?.find((record) => record.id === deletingId) ?? null;

  const closeDelete = () => {
    if (isDeleting) return;
    setDeletingId(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteError("");
    try {
      await onDelete(deleting);
      toast.success(`${recordLabel(deleting)} deleted.`);
      setDeletingId(null);
    } catch (error) {
      setDeleteError(
        toDeleteErrorMessage(error, recordLabel(deleting), `${recordLabel(deleting)} was not deleted. Try again.`),
      );
    }
  };

  const addButton = (
    <Button type="button" size="small" onClick={onAdd}>
      Add {noun}
    </Button>
  );

  return (
    <section className="flex flex-col gap-16" aria-labelledby={`fleet-${noun}-heading`}>
      <div className="flex flex-wrap items-center justify-between gap-12">
        <h2 id={`fleet-${noun}-heading`} className="title-heading-3">{title}</h2>
        {query.data && query.data.length > 0 && addButton}
      </div>

      {query.isLoading && !query.data ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <ServerError
          message={`${title} could not be loaded. Try again.`}
          action={<Button size="small" onClick={() => { void query.refetch(); }}>Try again</Button>}
        />
      ) : !query.data || query.data.length === 0 ? (
        <EmptyState
          icon={emptyIcon}
          title={`No ${title.toLowerCase()} yet`}
          description={emptyDescription}
          padding="sm"
          action={addButton}
        />
      ) : (
        <OrganizationRosterList>
          {query.data.map((record) => (
            <OrganizationRosterRow
              key={record.id}
              primary={primary(record)}
              secondary={secondary(record)}
              actions={
                <>
                  <Button
                    type="button"
                    variant="weak"
                    size="small"
                    aria-label={`Edit ${primary(record)}`}
                    onClick={() => onEdit(record)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="small"
                    aria-label={`Delete ${primary(record)}`}
                    onClick={() => setDeletingId(record.id)}
                  >
                    Delete
                  </Button>
                </>
              }
            />
          ))}
        </OrganizationRosterList>
      )}

      <DeleteConfirmDialog
        isOpen={deleting !== null}
        title={`Delete ${noun}`}
        message={deleting ? `Delete ${primary(deleting)}? This cannot be undone.` : ""}
        onConfirm={() => { void confirmDelete(); }}
        onCancel={closeDelete}
        isPending={isDeleting}
        errorMessage={deleteError || undefined}
      />
    </section>
  );
}
