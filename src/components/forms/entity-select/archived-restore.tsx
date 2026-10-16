/**
 * Restore renderers for archived records opened read-only from a picker. One
 * entry per entity type that can be archived and restored from the app; any
 * other archived type keeps the plain read-only notice.
 */
"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { ArchivedFormulationNotice } from "@/components/formulations/formulation-notices";
import { ArchivedCustomerNotice, ArchivedSupplierNotice } from "@/components/parties";
import { useToast } from "@/components/ui/toast";
import { useRestoreFormulation } from "@/hooks/use-formulations";
import { useRestoreSupplier } from "@/hooks/use-suppliers";
import { useRestoreCustomer } from "@/hooks/use-customers";
import type { EditableEntityType } from "@/hooks/use-entity-edit-record";
import { toArchiveRestoreErrorMessage } from "@/lib/stale-version";
import { ServerError } from "../server-error";

/** The fields every restorable record carries. */
export interface RestorableRecord {
  id: string;
  code: string;
  version: number;
}

export function isRestorableRecord(record: unknown): record is RestorableRecord {
  return typeof record === "object" && record !== null && "id" in record && "code" in record && "version" in record;
}

interface RestoreProps {
  record: RestorableRecord;
  onRestored: () => void;
}

/** Shows the archived notice and runs one version-checked restore. */
function ArchivedRestore({ record, onRestored, noun, label, Notice, restore, isPending }: RestoreProps & {
  noun: string;
  label: string;
  Notice: ComponentType<{ onRestore: () => void; isPending: boolean }>;
  restore: () => Promise<unknown>;
  isPending: boolean;
}) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const handleRestore = async () => {
    setError(null);
    try {
      await restore();
      toast.success(`${label} ${record.code} restored.`);
      onRestored();
    } catch (restoreError) {
      setError(toArchiveRestoreErrorMessage(restoreError, `${label} ${record.code}`, "restore", `The ${noun} was not restored. Try again.`));
    }
  };
  return (
    <>
      <Notice onRestore={handleRestore} isPending={isPending} />
      {error && <ServerError message={error} />}
    </>
  );
}

function ArchivedFormulationRestore(props: RestoreProps) {
  const restore = useRestoreFormulation();
  return (
    <ArchivedRestore {...props} noun="formulation" label="Formulation" Notice={ArchivedFormulationNotice}
      isPending={restore.isPending}
      restore={() => restore.mutateAsync({ formulationId: props.record.id, expectedVersion: props.record.version })} />
  );
}

function ArchivedSupplierRestore(props: RestoreProps) {
  const restore = useRestoreSupplier();
  return (
    <ArchivedRestore {...props} noun="supplier" label="Supplier" Notice={ArchivedSupplierNotice}
      isPending={restore.isPending}
      restore={() => restore.mutateAsync({ supplierId: props.record.id, expectedVersion: props.record.version })} />
  );
}

function ArchivedCustomerRestore(props: RestoreProps) {
  const restore = useRestoreCustomer();
  return (
    <ArchivedRestore {...props} noun="customer" label="Customer" Notice={ArchivedCustomerNotice}
      isPending={restore.isPending}
      restore={() => restore.mutateAsync({ customerId: props.record.id, expectedVersion: props.record.version })} />
  );
}

/** Archived records of these types open read-only with Restore as the way back to editing. */
export const ARCHIVED_RESTORE_RENDERERS: Partial<Record<EditableEntityType, (props: RestoreProps) => ReactNode>> = {
  formulation: (props) => <ArchivedFormulationRestore {...props} />,
  supplier: (props) => <ArchivedSupplierRestore {...props} />,
  customer: (props) => <ArchivedCustomerRestore {...props} />,
};
