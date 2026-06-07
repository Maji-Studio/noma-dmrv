"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  useDeleteTransportLeg,
  useTransportLegsForEntity,
} from "@/hooks/use-transport-legs";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import type { TransportLeg } from "@/db/schema";
import { TransportLegForm } from "./transport-leg-form";
import { TransportLegLine } from "./transport-leg-list-item";

interface TransportLegsEditorProps {
  entityType: TransportEntityTypeValue;
  entityId: string;
  /** Override the section title. Defaults based on entityType. */
  title?: string;
}

const DEFAULT_TITLES: Record<TransportEntityTypeValue, string> = {
  feedstock: "Transport: feedstock → processing",
  biochar: "Transport: biochar → storage",
  sample: "Transport: sample → lab",
};

type FormState =
  | { mode: "create" }
  | { mode: "edit"; leg: TransportLeg }
  | null;

/**
 * Edit-mode transport-leg management for the side sheet: list rows with
 * edit/delete plus an inline add/edit form rendered in place (no popup dialog).
 */
export function TransportLegsEditor({
  entityType,
  entityId,
  title,
}: TransportLegsEditorProps) {
  const { data: legs, isLoading, error } = useTransportLegsForEntity(
    entityType,
    entityId,
  );
  const deleteMutation = useDeleteTransportLeg(entityType, entityId);
  const toast = useToast();

  const [formState, setFormState] = useState<FormState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    try {
      await deleteMutation.mutateAsync({ id: deletingId });
      toast.success("Transport leg deleted");
      setDeletingId(null);
      setDeleteError(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete transport leg",
      );
    }
  };

  return (
    <section className="flex flex-col gap-12 border border-[var(--color-border-secondary)] p-16">
      <header className="flex items-center justify-between">
        <h3 className="title-heading-3">{title ?? DEFAULT_TITLES[entityType]}</h3>
        <Button
          variant="default"
          size="small"
          onClick={() => setFormState({ mode: "create" })}
        >
          Add leg
        </Button>
      </header>

      {error && (
        <ServerError
          message={
            error instanceof Error
              ? error.message
              : "Failed to load transport legs"
          }
        />
      )}

      {isLoading ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          Loading transport legs…
        </p>
      ) : !legs || legs.length === 0 ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          No transport legs recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-8">
          {legs.map((leg) => (
            <li
              key={leg.id}
              className="flex items-start justify-between gap-12 border border-[var(--color-border-secondary)] p-12"
            >
              <TransportLegLine leg={leg} />
              <div className="flex gap-8">
                <Button
                  variant="weak"
                  size="small"
                  onClick={() => setFormState({ mode: "edit", leg })}
                >
                  Edit
                </Button>
                <Button
                  variant="weak"
                  size="small"
                  onClick={() => setDeletingId(leg.id)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deleteError && <ServerError message={deleteError} />}

      {formState && (
        <TransportLegForm
          key={formState.mode === "edit" ? formState.leg.id : "create"}
          isOpen
          onClose={() => setFormState(null)}
          entityType={entityType}
          entityId={entityId}
          leg={formState.mode === "edit" ? formState.leg : null}
        />
      )}

      <DeleteConfirmDialog
        isOpen={!!deletingId}
        title="Delete transport leg"
        message="This transport leg will be permanently removed. This cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingId(null);
          setDeleteError(null);
        }}
        isPending={deleteMutation.isPending}
      />
    </section>
  );
}
