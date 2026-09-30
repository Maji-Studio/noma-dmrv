/**
 * ServerError component
 * Displays server-side errors as a blocking Notice (tinted, role="alert").
 */

import type { ReactNode } from "react";
import { Notice } from "@/components/ui/notice";

interface ServerErrorProps {
  message?: string;
  /** Detail about the records the refusal named, rendered under the message. */
  action?: ReactNode;
}

export function ServerError({ message, action }: ServerErrorProps) {
  if (!message) return null;

  return (
    <Notice tone="error">
      <p>{message}</p>
      {action && <div className="mt-8">{action}</div>}
    </Notice>
  );
}
