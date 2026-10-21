/**
 * Guided Removal template setup (#1276). Owner and Admin only: a Member goes
 * back to the read-only summary in Settings. The page reads the templates live
 * and stores nothing until Apply.
 */
import { redirect } from "next/navigation";
import { RemovalTemplateSetupPage } from "@/components/certification/removal-template-setup";
import { hasOrgRole, requireOrgContext } from "@/lib/auth/server";
import { certificationRemovalTemplatesHref, CERTIFICATION_SETTINGS_REMOVAL_TEMPLATES_SECTION } from "@/lib/certification/links";

type Param = string | string[] | undefined;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value);

export default async function RemovalTemplateSetupRoute({ searchParams }: { searchParams: Promise<Record<string, Param>> }) {
  const params = await searchParams;
  const ctx = await requireOrgContext();
  const facility = first(params.facility);
  if (!hasOrgRole(ctx, "admin")) {
    redirect(facility ? certificationRemovalTemplatesHref(facility) : `/certification/settings?section=${CERTIFICATION_SETTINGS_REMOVAL_TEMPLATES_SECTION}`);
  }
  return (
    <RemovalTemplateSetupPage
      facilityParam={facility}
      templateParam={first(params.template)}
      stepParam={first(params.step)}
      makeDefaultParam={first(params.makeDefault)}
    />
  );
}
