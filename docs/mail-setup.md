# Mail Setup

Transactional password setup, reset, verification and organization-invitation email uses
`src/lib/email/send.ts` → Resend. Read this when mail is missing or when changing
an email handler. Auth policy lives in [auth.md](./auth.md); secrets and the
hermetic-CI exception live in [security.md](./security.md).

## Configuration

Real production refuses to boot unless `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
and `RESEND_REPLY_TO` are all set. The error names every missing variable.
Use a sender on a domain verified in Resend and a monitored reply-to mailbox.
Every email uses the configured sender and defaults to the configured reply-to address.
Optional `WALKTHROUGH_TO` receives public walkthrough requests, with the visitor's
email as reply-to. Blank is unset; missing mail configuration returns 503.

The API key and from address remain a **both-or-neither pair** in every
environment. `RESEND_REPLY_TO` is an optional, validated email address outside
production. Development/test and hermetic CI can omit all three: no mail is
sent and links are printed to the local console only outside production.
Hermetic production builds never print links.

`NEXT_PUBLIC_APP_URL` determines the host in invitation and auth links. Set it
to the deployed app URL, then exercise reset, verification and invitation flows.

## Templates and previews

Every email is built in `src/lib/email/templates/`. One function per email
(`set-password-email.ts`, `reset-password-email.ts`, `verify-email-email.ts`, `invitation-email.ts`)
returns `{ subject, preheader, html, text }` through `composeEmail`. The look
lives only in `panel-layout.ts` (colours, widths, dark-mode styles); copy lives
in the per-email files; `plain-text.ts` builds the text twin. Every user value
is HTML-escaped by the layout. Do not write inline HTML in a handler.

Drawings and the logo are PNGs in `public/email/` (`<name>.png` plus
`<name>-dark.png`), loaded by absolute URL from `NEXT_PUBLIC_APP_URL`. The
proxy matcher skips `.png`, so they need no session.

Preview with example data, images read from disk:
`pnpm tsx scripts/render-email-previews.ts /tmp/email-previews`, then open the
`.html` files. Dark mode follows the browser's colour scheme.

## Delivery outcomes

The shared sender checks both Resend's returned `error` and thrown exceptions.
Logs contain email type, stable IDs, provider status code and message ID only;
provider error text and addresses must never be logged.

- Password setup and reset log delivery failures but keep the same response as an
  unknown account to avoid revealing account existence.
- Verification logs failures and propagates a generic delivery error.
- Invitations are saved before sending. Settings member invites (including
  Platform Admin overrides) and Platform Organizations creation share one
  invitation helper and return `emailSent` with the accept link. Delivery
  failure keeps the invitation and the action succeeds. Existing-account first
  Admins are added directly and receive no invitation.

Better Auth's invitation hook handles direct HTTP calls only; server actions
send after creation so they can return delivery status without double-sending.
`emailSent` means Resend accepted the message, not confirmed inbox delivery.

Invited users without a credential password receive "Set your noma password";
users with a credential password receive the existing reset email. Both use the
same one-hour reset-token lifetime. The set-password link preserves the invitation
id through Better Auth's callback. With mail unconfigured, the local console
prints `[auth:set-password]` with the user ID and link, just as it does for reset.
No fallback links are printed in production.

Invitation setup requests acknowledge success during the resend cooldown and on
provider failure. Their `emailSent` acknowledgement is distinct from the inviter's
provider-delivery result described above.
