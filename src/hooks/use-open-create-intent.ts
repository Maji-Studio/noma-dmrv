"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  CREATE_INTENT_PARAM,
  isCreateIntentValue,
} from "@/lib/create-intent";

export interface OpenCreateIntentOptions {
  initialOpen?: boolean;
  contextParam?: string;
  initialContext?: string | null;
}

/**
 * Owns create deep-link state without depending on a caller callback's identity.
 * Server pages pass `initialOpen` (and optional context) so hard entries render
 * the create sheet immediately; the effect only captures client navigations and
 * consumes the handled query parameters.
 */
export function useOpenCreateIntent(
  optionsOrLegacyCallback: OpenCreateIntentOptions | (() => void) = {},
) {
  const legacyCallback =
    typeof optionsOrLegacyCallback === "function"
      ? optionsOrLegacyCallback
      : null;
  const initialOpen =
    typeof optionsOrLegacyCallback === "function"
      ? false
      : (optionsOrLegacyCallback.initialOpen ?? false);
  const contextParam =
    typeof optionsOrLegacyCallback === "function"
      ? undefined
      : optionsOrLegacyCallback.contextParam;
  const initialContext =
    typeof optionsOrLegacyCallback === "function"
      ? null
      : (optionsOrLegacyCallback.initialContext ?? null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handledRef = useRef(false);
  const [intent, setIntent] = useState<{ context: string | null } | null>(() =>
    initialOpen ? { context: initialContext } : null,
  );

  useEffect(() => {
    const shouldOpen = isCreateIntentValue(
      searchParams.get(CREATE_INTENT_PARAM),
    );

    if (!shouldOpen) {
      handledRef.current = false;
      return;
    }

    if (handledRef.current) {
      return;
    }

    handledRef.current = true;
    if (legacyCallback) {
      legacyCallback();
    } else {
      const context = contextParam ? searchParams.get(contextParam) : null;
      queueMicrotask(() => setIntent({ context }));
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete(CREATE_INTENT_PARAM);
    if (contextParam) {
      nextParams.delete(contextParam);
    }
    const nextQuery = nextParams.toString();

    // Keep this a same-document URL cleanup. A framework navigation asks the
    // server page for fresh props, which can remount the client list with
    // `initialOpen=false` and close the sheet that just opened.
    window.history.replaceState(
      window.history.state,
      "",
      nextQuery ? `${pathname}?${nextQuery}` : pathname,
    );
  }, [contextParam, legacyCallback, pathname, searchParams]);

  return {
    isOpen: intent !== null,
    context: intent?.context ?? null,
    clear: () => setIntent(null),
  };
}
