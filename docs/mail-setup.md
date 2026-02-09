# Mail Setup

This template uses Better Auth for email-based authentication flows and Resend for delivery.

## Supported Flows

- Password reset (`/forgot-password` -> `/reset-password`)
- Email verification (`/verify-email`)

## Environment Variables

```bash
# Required
NEXT_PUBLIC_APP_URL=http://localhost:3100
BETTER_AUTH_SECRET=your-32-character-secret-here-change-this

# Optional for local development
# Required in production for real email delivery
RESEND_API_KEY=
RESEND_FROM_EMAIL=
```

## Behavior by Environment

### With Resend configured

If both `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set, auth emails are sent through Resend.

### Without Resend configured (local fallback)

If either variable is missing, the app does not fail auth flows. Instead, it logs verification/reset URLs to the server console.

Look for messages like:

```text
[auth:reset-password] RESEND_* env vars are not configured, using local fallback.
[auth:reset-password] userId=... email=... url=http://localhost:3100/reset-password?token=...
```

You can open the logged URL directly in your browser to continue the flow.

## Where It Is Configured

- Auth email handlers: `src/lib/auth/better-auth.ts`
- Env validation: `src/config/env.ts`

## Local Testing Checklist

1. Start app: `pnpm dev` (or `pnpm dev:manual` if DB is already running)
2. Open `http://localhost:3100/forgot-password`
3. Submit a seeded/local user email
4. If Resend is configured, check inbox
5. If Resend is not configured, copy the logged URL from server output

## Production Checklist

1. Set `RESEND_API_KEY`
2. Set `RESEND_FROM_EMAIL` with a verified domain/sender in Resend
3. Set `NEXT_PUBLIC_APP_URL` to the production URL
4. Set `BETTER_AUTH_SECRET` to a strong secret (32+ chars)
5. Verify reset and email verification flows in deployed environment
