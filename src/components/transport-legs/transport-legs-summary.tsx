"use client";

import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import { TransportLegsEditor } from "./transport-legs-editor";

interface TransportLegsSummaryProps {
  entityType: TransportEntityTypeValue;
  entityId: string;
  /** Override the section title. Defaults based on entityType. */
  title?: string;
}

/**
 * Read-only transport-leg list for the side-sheet view mode. Renders the same
 * table as the editor (via `readOnly`) so view and edit stay visually identical.
 */
export function TransportLegsSummary({
  entityType,
  entityId,
  title,
}: TransportLegsSummaryProps) {
  return (
    <TransportLegsEditor
      entityType={entityType}
      entityId={entityId}
      title={title}
      readOnly
    />
  );
}
