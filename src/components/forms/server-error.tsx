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
      {/* The type class beats the global `p` size, as on the Notice title. The
          leading space is not drawn, but keeps the message one sentence apart
          from the title in its text ("…this batch. A credit batch…"). */}
      {detail && <p className="body-small">{" "}{detail}</p>}
      {action && <div className="mt-8">{action}</div>}
    </Notice>
  );
}
