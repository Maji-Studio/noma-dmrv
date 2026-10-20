/**
 * `/settings` — no page of its own.
 *
 * The rail in `SettingsConsole` is the index, so a landing page here would be a
 * tile grid duplicating a menu that is permanently on screen. That is what
 * `/admin` was. Members is the entry every member can reach.
 *
 * Prototype (branch prototype/settings-simplification, never merged):
 * `?variant=A..E` renders a settings prototype variant instead of redirecting.
 */
import { redirect } from "next/navigation";
import { SettingsPrototype } from "@/components/settings/prototype/settings-prototype";
import { parseSettingsPrototypeVariant } from "@/components/settings/prototype/settings-prototype-variants";
import { SETTINGS_MEMBERS_HREF } from "@/lib/settings/links";

export default async function SettingsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string | string[] }>;
}) {
  const { variant } = await searchParams;
  const value = Array.isArray(variant) ? variant[0] : variant;
  if (
    process.env.NODE_ENV !== "production" &&
    parseSettingsPrototypeVariant(value)
  ) {
    return <SettingsPrototype />;
  }
  redirect(SETTINGS_MEMBERS_HREF);
}
