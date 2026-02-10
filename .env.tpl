# =============================================================================
# noma-dmrv Environment Variables (1Password Template)
# =============================================================================
# Run: pnpm env:local to inject values from 1Password

# -----------------------------------------------------------------------------
# Database (PostgreSQL via Drizzle ORM)
# -----------------------------------------------------------------------------
DATABASE_URL="op://Environment Variables/noma-dmrv env dev/DATABASE_URL"

# -----------------------------------------------------------------------------
# App URL (Used for Better Auth and general app links)
# -----------------------------------------------------------------------------
NEXT_PUBLIC_APP_URL="op://Environment Variables/noma-dmrv env dev/NEXT_PUBLIC_APP_URL"

# -----------------------------------------------------------------------------
# Better Auth (Authentication)
# -----------------------------------------------------------------------------
BETTER_AUTH_SECRET="op://Environment Variables/noma-dmrv env dev/BETTER_AUTH_SECRET"

# -----------------------------------------------------------------------------
# Resend (Email Service)
# -----------------------------------------------------------------------------
RESEND_API_KEY="op://Environment Variables/noma-dmrv env dev/RESEND_API_KEY"
RESEND_FROM_EMAIL="op://Environment Variables/noma-dmrv env dev/RESEND_FROM_EMAIL"

# -----------------------------------------------------------------------------
# Admin Configuration
# -----------------------------------------------------------------------------
ADMIN_EMAIL="op://Environment Variables/noma-dmrv env dev/ADMIN_EMAIL"

# -----------------------------------------------------------------------------
# Optional (uncomment if stored in 1Password)
# -----------------------------------------------------------------------------
# LOG_LEVEL="op://Environment Variables/noma-dmrv env dev/LOG_LEVEL"

# -----------------------------------------------------------------------------
# App Configuration
# -----------------------------------------------------------------------------
NODE_ENV=development
