/**
 * `/certification/settings` folded into the settings console (#1277). Every
 * `?section=` it ever had, including the retired `connection` and
 * `credentials`, redirects to the pane that absorbed it, keeping `?facility=`
 * and `?template=`. The platform sections land on Registry for anyone who is
 * not a Platform Admin.
 */
import { permanentRedirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/server";
import {
  legacyCertificationSettingsRedirect,
  type CertificationSearchParams,
} from "@/lib/certification/links";

export default async function CertificationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<CertificationSearchParams>;
}) {
  const ctx = await getOrgContext();
  permanentRedirect(
    legacyCertificationSettingsRedirect(await searchParams, {
      isPlatformAdmin: ctx?.isPlatformAdmin ?? false,
    }),
  );
}
