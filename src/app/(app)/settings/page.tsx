/**
 * `/settings` — no page of its own.
 *
 * The rail in `SettingsConsole` is the index, so a landing page here would be a
 * tile grid duplicating a menu that is permanently on screen. That is what
 * `/admin` was. Members is the entry every member can reach.
 */
import { redirect } from "next/navigation";
import { SETTINGS_MEMBERS_HREF } from "@/components/settings/settings-console";

export default function SettingsIndexPage() {
  redirect(SETTINGS_MEMBERS_HREF);
}
