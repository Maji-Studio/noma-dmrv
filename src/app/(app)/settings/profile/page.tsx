/**
 * Settings, Profile: your own name, email and password. Every signed-in person sees
 * it, Platform Admins included; it changes nothing in the organization.
 */
import { ProfileSettingsPane, SettingsConsole } from "@/components/settings";
import { requireAuth } from "@/lib/auth/server";
import { loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function ProfileSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error } = await searchParams;
  const [{ viewer }, user] = await Promise.all([loadSettingsViewer(), requireAuth()]);
  return (
    <SettingsConsole pane="profile" viewer={viewer}>
      <ProfileSettingsPane name={user.name ?? ""} email={user.email} linkError={typeof error === "string" ? error : undefined} />
    </SettingsConsole>
  );
}
