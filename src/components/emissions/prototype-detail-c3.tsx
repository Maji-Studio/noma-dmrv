/**
 * PROTOTYPE detail C3: PLACEHOLDER. Another agent replaces this whole file
 * with its own variant, built on the shared detail API in
 * prototype-detail-shared.tsx. Keep the export names `DetailC3` and
 * `DETAIL_C3_NAME` (the switcher label) and the props.
 */
"use client";

import type { usePrototypeEmissions } from "./prototype-emissions-shared";
import { ProtoNote } from "./prototype-emissions-shared";
import { DetailC1 } from "./prototype-detail-c1";

export const DETAIL_C3_NAME = "In progress";

export function DetailC3({ data, batchId }: { data: ReturnType<typeof usePrototypeEmissions>; batchId: string }) {
  return (
    <>
      <div className="container-max pt-16">
        <ProtoNote>Variant C3 is being built. This shows C1 for now.</ProtoNote>
      </div>
      <DetailC1 data={data} batchId={batchId} />
    </>
  );
}
