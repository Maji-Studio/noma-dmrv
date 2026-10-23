# Mail Setup

Transactional reset, verification and organization-invitation email uses
`src/lib/email/send.ts` → Resend. Read this when mail is missing or when changing
an email handler. Auth policy lives in [auth.md](./auth.md); secrets and the
hermetic-CI exception live in [security.md](./security.md).

## Configuration

Real production refuses to boot unless `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
and `RESEND_REPLY_TO` are all set. The error names every missing variable.
Use a sender on a domain verified in Resend and a monitored reply-to mailbox.
Every email uses the configured sender and reply-to address.

The API key and from address remain a **both-or-neither pair** in every
environment. `RESEND_REPLY_TO` is an optional, validated email address outside
production. Development/test and hermetic CI can omit all three: no mail is
sent and links are printed to the local console only outside production.
Hermetic production builds never print links.

`NEXT_PUBLIC_APP_URL` determines the host in invitation and auth links. Set it
to the deployed app URL, then exercise reset, verification and invitation flows.

## Delivery outcomes

The shared sender checks both Resend's returned `error` and thrown exceptions.
Logs contain email type, stable IDs, provider status code and message ID only;
provider error text and addresses must never be logged.

- Password reset logs delivery failures but keeps the same response as an
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
