/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). Question: how
 * should noma show what share of each emissions source record a credit batch
 * carries (Emissions tab) and a Removal carries (Removal sheet), so nothing is
 * counted twice? Round 2: one Allocation section with a Flow view (default)
 * and a Table view, on fixture data mirroring staging TZ001. Round 3: the kept
 * rule (whole delivery on the first drawing batch) and two hint treatments.
 * Params: ?view=flow|table&surface=batch|removal&focus=<CB or RM code>&removals=one|two&hint=a|b
 */
"use client";

import { AllocationSection, type AllocationView } from "./allocation-section";
import { focusFor, type RemovalFixture, type Surface } from "./fixture";
import type { HintMode } from "./hints";
import { AllocationSwitcher } from "./prototype-switcher";
import { BatchSurface, RemovalSurface } from "./surfaces";

export interface AllocationPrototypeParams {
  view?: string;
  surface?: string;
  focus?: string;
  removals?: string;
  hint?: string;
}

const SHEET_CLOSED = "none";

export function AllocationPrototype(params: AllocationPrototypeParams) {
  const view: AllocationView = params.view === "table" ? "table" : "flow";
  const surface: Surface = params.surface === "removal" ? "removal" : "batch";
  const fixture: RemovalFixture = params.removals === "two" ? "two" : "one";
  const open = params.focus !== SHEET_CLOSED;
  const hint: HintMode = params.hint === "b" ? "b" : "a";
  const focus = focusFor(surface, params.focus ?? "", fixture);
  const body = <AllocationSection key={`${surface}-${fixture}-${focus.owner.key}`} focus={focus} fixture={fixture} view={view} hint={hint} />;
  return (
    <>
      {surface === "batch" ? (
        <BatchSurface focus={focus}>{body}</BatchSurface>
      ) : (
        <RemovalSurface focus={focus} fixture={fixture} open={open}>{body}</RemovalSurface>
      )}
      <AllocationSwitcher surface={surface} focusKey={focus.owner.key} fixture={fixture} hint={hint} />
    </>
  );
}
