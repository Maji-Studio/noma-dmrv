"use client";

import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import { TransportLegsEditor } from "./transport-legs-editor";

interface TransportLegsSummaryProps {
  entityType: TransportEntityTypeValue;
  entityId: string;
  /** Override the section title. Defaults based on entityType. */
  title?: string;
  /** Override the no-legs message (e.g. for auto-derived categories). */
  emptyMessage?: string;
  /** Drop the caption and CERT chip when the step already names and badges the route. */
  hideHeader?: boolean;
  /** PROTOTYPE: carry the CERT chip on the Route label. */
  routeCert?: boolean;
}

/**
 * Read-only transport-leg list for the side-sheet view mode. Renders the same
 * journey timeline as the editor (via `readOnly`) so view and edit stay
 * visually identical, minus the add/edit/delete controls.
 */
export function TransportLegsSummary({
  entityType,
  entityId,
  title,
  emptyMessage,
  hideHeader,
  routeCert,
}: TransportLegsSummaryProps) {
  return (
    <TransportLegsEditor
      entityType={entityType}
      entityId={entityId}
      title={title}
      emptyMessage={emptyMessage}
      readOnly
      hideHeader={hideHeader}
      routeCert={routeCert}
    />
  );
}
