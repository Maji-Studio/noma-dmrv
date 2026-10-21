/**
 * ServerError component
 * Displays server-side errors as a blocking Notice (tinted, role="alert"):
 * the first sentence as the bold title, the rest as the detail.
 */

import type { ReactNode } from "react";
import { Notice } from "@/components/ui/notice";
import { splitErrorMessage } from "@/lib/error-title";

interface ServerErrorProps {
  message?: string;
  /** Detail about the records the refusal named, rendered under the message. */
  action?: ReactNode;
}

export function ServerError({ message, action }: ServerErrorProps) {
  if (!message) return null;

  const { title, detail } = splitErrorMessage(message);
  return (
    <Notice tone="error" title={title}>
      {detail && <p>{detail}</p>}
      {action && <div className="mt-8">{action}</div>}
    </Notice>
  );
}
