"use client";

/** The one load failure for Activity reads: what failed, and a Retry that refetches every read. */
import { Button } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import { ACTIVITY_LOAD_ERROR } from "./activity-copy";

type Refetchable = { isFetching: boolean; refetch: () => unknown };

export function ActivityLoadError({ queries }: { queries: readonly Refetchable[] }) {
  return (
    <Notice
      tone="warning"
      action={
        <Button
          variant="weak"
          size="small"
          className="min-h-44"
          busy={queries.some((query) => query.isFetching)}
          onClick={() => {
            for (const query of queries) void query.refetch();
          }}
        >
          Retry
        </Button>
      }
    >
      {ACTIVITY_LOAD_ERROR}
    </Notice>
  );
}
