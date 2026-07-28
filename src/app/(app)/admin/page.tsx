/**
 * /admin — the Platform-Admin entry point.
 *
 * This used to be a three-tile launcher, but two of its tiles were cross-links
 * to pages the sidebar already carries (`/settings/organization` and
 * `/certification/settings`) and the third — the organization directory — is
 * the only surface that lives under `/admin` at all. A hub with one real
 * destination is a hop, not an index, so `/admin` goes straight there.
 *
 * Organization configuration an operator can change moved to `/settings`, which
 * is gated on org Owner/Admin rather than `users.role === "admin"`. The tile
 * grid's audience could never reach the settings it advertised.
 *
 * The route is kept rather than deleted so the parent layout's requireAdmin()
 * still answers `/admin` for unauthenticated and non-admin visitors.
 */
import { redirect } from "next/navigation";

export default function AdminHomePage() {
  redirect("/admin/organizations");
}
