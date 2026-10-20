/**
 * PROTOTYPE (#1276), not for merge. Mounted by CertificationSettings in place
 * of the Removal templates pane when `?variant=a|b|c` is set.
 *
 *   ?variant=a  Stepper dialog over Settings
 *   ?variant=b  Full-page wizard (/certification/settings/removal-template-setup)
 *   ?variant=c  One checklist in the pane
 *   &scenario=protocol (default) | ready
 *   &state=done   the summary card Settings shows afterwards
 *   &shot=1       hides the prototype switcher for screenshots
 */
"use client";

import { useProtoParams } from "./shared";
import { VariantA } from "./variant-a";
import { VariantBPane } from "./variant-b";
import { VariantC } from "./variant-c";

export { useProtoParams } from "./shared";
export { ProtoSwitcher } from "./switcher";

export function TemplateSetupProto() {
  const { variant, scenario, done } = useProtoParams();
  // Remount on every switch so each variant starts from its own clean state.
  const key = `${variant}-${scenario.key}-${done}`;
  if (variant === "a") return <VariantA key={key} />;
  if (variant === "b") return <VariantBPane key={key} />;
  return <VariantC key={key} />;
}
