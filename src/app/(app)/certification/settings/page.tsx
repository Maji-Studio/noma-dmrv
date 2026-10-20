/**
 * `/certification/settings` folded into the settings console (#1277). Every
 * `?section=` it ever had, including the retired `connection` and
 * `credentials`, redirects to the pane that absorbed it, keeping `?facility=`
 * and `?template=`.
 */
import { permanentRedirect } from "next/navigation";
import {
  legacyCertificationSettingsRedirect,
  type CertificationSearchParams,
} from "@/lib/certification/links";

export default async function CertificationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<CertificationSearchParams>;
}) {
  permanentRedirect(legacyCertificationSettingsRedirect(await searchParams));
}
