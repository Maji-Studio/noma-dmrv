# Mail Setup

How transactional auth email is delivered (Better Auth handlers → Resend) and
how the no-Resend local fallback behaves. Read it when an auth email is not
arriving, or before changing an email handler. Auth flows and route protection
are owned by [auth.md](./auth.md); the env inventory and secrets handling by
[security.md](./security.md).

## Flows That Send Mail

| Flow | Route | Handler |
|---|---|---|
| Password reset | `/forgot-password` → `/reset-password` | `sendResetPassword` |
| Email verification | `/verify-email` | `sendVerificationEmail` |
| Org invitation | `/accept-invitation/<invitationId>` | organization plugin `sendInvitationEmail` |

Signup is invite-first, so the invitation mail is the entry point for most new
users. It is deliberately **best-effort**: the invite action also surfaces a
copyable accept link in the UI, so a mail failure never blocks onboarding.

## Configuration

Handlers live in `src/lib/auth/better-auth.ts`; env validation in
`src/config/env.ts`.

`RESEND_API_KEY` and `RESEND_FROM_EMAIL` are validated as a **both-or-neither
pair** — setting only one fails env validation at boot with
`"RESEND_API_KEY and RESEND_FROM_EMAIL must either both be set or both be
omitted"`. There is no half-configured state.

- **Both set** → mail is sent through Resend.
- **Both omitted** → local fallback: nothing is sent, and the target URL is
  logged to the server console. Open it directly to continue the flow.

```text
[auth:reset-password] RESEND_* env vars are not configured, using local fallback.
[auth:reset-password] userId=... url=http://localhost:3100/reset-password?token=...
```

The fallback logs `userId` and the URL, never the recipient address — the
no-PII-in-logs rule applies to mail code like everywhere else.

`NEXT_PUBLIC_APP_URL` is what every emailed link is built from. If reset or
invitation links point at the wrong host, that is the variable to check.

## Production Checklist

1. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` together, with a sender on a
   domain verified in Resend.
2. Set `NEXT_PUBLIC_APP_URL` to the deployed URL, or emailed links will 404.
3. Exercise reset and invitation flows against the deployed environment — the
   fallback is silent-by-design, so an unset pair looks identical to success
   from the UI.
