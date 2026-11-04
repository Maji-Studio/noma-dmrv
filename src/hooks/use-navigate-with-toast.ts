"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { queueArrivalToast } from "@/lib/arrival-toast";

const PATH_BASE = "http://noma.invalid";

/**
 * In-app navigation that ends a flow with a success toast: a delete that
 * returns to its list. `isPending` holds from the call until the destination
 * route has rendered, so the caller keeps its dialog busy for exactly that
 * long, and the toast (shown by `ToastProvider` on arrival) never appears
 * beside a dialog that still reads busy. Only a failure to start (the request
 * before it) ends the busy state early; the caller handles that itself.
 */
export function useNavigateWithToast() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return {
    isPending,
    navigate: (href: string, successMessage: string) => {
      queueArrivalToast(new URL(href, PATH_BASE).pathname, successMessage);
      startTransition(() => router.push(href));
    },
  };
}
