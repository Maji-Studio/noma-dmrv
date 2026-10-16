/** PROTOTYPE placeholder for C3b, replaced by its builder. */
"use client";

import { DetailC3 } from "./prototype-detail-c3";

export const DETAIL_C3B_NAME = "Stacked figure";

export function DetailC3B(props: React.ComponentProps<typeof DetailC3>) {
  return (
    <>
      <p className="container-max body-small">Placeholder, being built</p>
      <DetailC3 {...props} />
    </>
  );
}
