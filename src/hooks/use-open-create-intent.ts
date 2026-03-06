"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useOpenCreateIntent(onOpenCreate: () => void) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handledRef = useRef(false);

  useEffect(() => {
    const shouldOpen =
      searchParams.get("create") === "true" ||
      searchParams.get("create") === "1";

    if (!shouldOpen) {
      handledRef.current = false;
      return;
    }

    if (handledRef.current) {
      return;
    }

    handledRef.current = true;
    onOpenCreate();

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("create");
    const nextQuery = nextParams.toString();

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [onOpenCreate, pathname, router, searchParams]);
}
