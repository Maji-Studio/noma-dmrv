# Troubleshooting Guide

Quick symptom-to-fix lookup for common issues. Keep this file concise and searchable.

## Development Server Issues

### Port 3100 Already in Use

**Symptoms**
- Error: `EADDRINUSE: address already in use :::3100`
- Dev server won't start

**Fixes**
```bash
# Find and kill process on port 3100
lsof -ti:3100 | xargs kill -9

# Or use a different port
pnpm dev -- -p 3101
```

### Next.js Cache Issues

**Symptoms**
- Stale UI after git pull/merge
- Build errors after dependency updates
- Changes not reflecting in browser
- Type errors that don't make sense

**Fixes**
```bash
# Clear Next.js cache
rm -rf .next

# Clear all caches and reinstall
rm -rf .next node_modules .pnpm-store
pnpm install

# Restart dev server
pnpm dev
```

### Hot Reload Not Working

**Symptoms**
- Changes don't appear without manual refresh
- Console shows connection errors

**Fixes**
- Check no firewall blocking localhost:3100
- Try `WATCHPACK_POLLING=true pnpm dev` (uses polling instead of file watching)
- Restart dev server

## Database Issues

### Connection Pool Exhaustion

**Symptoms**
- Error: `remaining connection slots are reserved for roles with the SUPERUSER attribute`
- Error code: `53300`
- App works initially, then crashes under load

**Root Cause**
- PostgreSQL has limited `max_connections` (typically 20-50 on VPS)
- Each process creates connection pools
- Default pool size (10) can quickly exhaust database

**Fixes**

1. **Reduce pool size** (src/db/index.ts:8)
   ```typescript
   // Change from 10 to 3-5 for typical apps
   const pool = new Pool({
     connectionString: DATABASE_URL,
     max: 5, // Reduced from default 10
   });
   ```

2. **Increase database max_connections** (requires database admin)
   ```sql
   -- Check current limit
   SHOW max_connections;

   -- Check current usage
   SELECT count(*) FROM pg_stat_activity;

   -- Edit postgresql.conf and restart
   max_connections = 100
   ```

3. **Use PgBouncer** (recommended for production)
   - Connection pooling middleware
   - Allows hundreds of app connections with ~20 database connections
   - Update DATABASE_URL to point to PgBouncer port (6432)

### DATABASE_URL Not Found

**Symptoms**
- Error: `DATABASE_URL is undefined`
- App crashes on startup
- Scripts fail to connect

**Fixes**
- Ensure `.env.local` exists with `DATABASE_URL`
- For standalone scripts, add `import "dotenv/config";` at top
- Verify variable name is exact (case-sensitive)
- Check no trailing spaces in .env.local

### Migration Failures

**Symptoms**
- `pnpm db:push` fails with constraint errors
- Schema out of sync with database

**Fixes**
```bash
# For development - force push (DESTRUCTIVE)
pnpm db:push

# For production - generate migration and review SQL
pnpm db:generate
# Review migration file in drizzle/ folder
pnpm db:migrate

# Reset local database (DESTRUCTIVE)
# Drop all tables manually or recreate database
pnpm db:push
```

**Prevention**
- ❌ Never use `pnpm db:push` in production
- ✅ Always use `pnpm db:generate` + review migrations
- ✅ Test migrations on staging first

### Connection Refused / Connection Timeout

**Symptoms**
- `ECONNREFUSED`
- `connection timeout`
- Can't connect to database

**Fixes**
- Verify PostgreSQL is running: `pg_isready`
- Check DATABASE_URL format: `postgresql://user:pass@host:port/db?sslmode=require`
- For local: ensure host is `localhost` or `127.0.0.1`
- For remote: ensure `sslmode=require` parameter
- Check firewall/security groups allow connections
- Verify credentials are correct

## Authentication Issues

### Email Not Sending

**Symptoms**
- Invite emails not received
- Password reset emails not arriving
- No error in console

**Fixes**
- Verify `RESEND_API_KEY` is set in `.env.local`
- Check `RESEND_FROM_EMAIL` is verified in Resend dashboard
- Test API key: `curl -X POST https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY"`
- Check spam folder
- View Resend dashboard for delivery status
- For local development without Resend, leave `RESEND_API_KEY` and `RESEND_FROM_EMAIL` empty and use reset/verification URLs logged in server output.

### Can't Log In / Session Issues

**Symptoms**
- Redirected to login after successful login
- Session expires immediately
- "Unauthorized" errors

**Fixes**
```bash
# Clear sessions
pnpm db:studio
# Delete all rows from `session` table

# Regenerate auth secret
openssl rand -base64 32
# Update BETTER_AUTH_SECRET in .env.local

# Restart dev server
pnpm dev
```

**Common Causes**
- `BETTER_AUTH_SECRET` changed (invalidates all sessions)
- `NEXT_PUBLIC_APP_URL` doesn't match actual URL
- Cookies blocked in browser
- Mixed HTTP/HTTPS (cookies won't persist)

### Password Reset Not Working

**Symptoms**
- Reset link expired
- Token invalid errors

**Fixes**
- Tokens expire after 1 hour by default
- Check email was sent (see Email Not Sending above)
- Verify `NEXT_PUBLIC_APP_URL` matches actual app URL
- Clear old tokens: Delete rows from `verification` table in db:studio

### Can't Create Admin User

**Symptoms**
- Admin script fails
- User created but not admin

**Fixes**
- Verify email in `ADMIN_EMAIL` env var
- Emails are case-sensitive
- Restart server after changing ADMIN_EMAIL
- Check user's email in database matches exactly

## Build & Deployment Issues

### Type Errors During Build

**Symptoms**
- `pnpm build` fails with TypeScript errors
- Dev server works fine

**Fixes**
```bash
# Clear TypeScript cache
rm -rf .next tsconfig.tsbuildinfo

# Verify types
pnpm tsc --noEmit

# Check for `any` types in strict mode
# Fix by adding proper types
```

### Production Build Size Too Large

**Symptoms**
- Build exceeds size limits
- Slow page loads

**Fixes**
- Analyze bundle: `pnpm build` (outputs size analysis)
- Check for:
  - Unused dependencies imported
  - Large libraries not code-split
  - Images not optimized
- Use dynamic imports for heavy components:
  ```typescript
  const HeavyComponent = dynamic(() => import('./HeavyComponent'))
  ```

### Environment Variables Not Working in Production

**Symptoms**
- `undefined` for env vars in production
- Works locally

**Fixes**
- Client-side vars MUST start with `NEXT_PUBLIC_`
- Server-side vars work without prefix
- Rebuild after adding env vars
- For Vercel/deployment platforms: set env vars in dashboard
- Check `src/config/env.ts` validates all required vars

## Dependency Issues

### pnpm install Fails

**Symptoms**
- Peer dependency conflicts
- Package not found

**Fixes**
```bash
# Clear pnpm cache
pnpm store prune

# Remove lock file and reinstall
rm pnpm-lock.yaml
pnpm install

# For stubborn issues
rm -rf node_modules .pnpm-store pnpm-lock.yaml
pnpm install
```

### Module Not Found Errors

**Symptoms**
- `Cannot find module '@/...'`
- Import errors for valid paths

**Fixes**
- Clear cache: `rm -rf .next`
- Check `tsconfig.json` has correct paths:
  ```json
  {
    "compilerOptions": {
      "paths": {
        "@/*": ["./src/*"]
      }
    }
  }
  ```
- Restart TypeScript server in VSCode: Cmd+Shift+P → "Restart TS Server"

## React Query Issues

### Stale Data Showing

**Symptoms**
- UI shows old data after mutation
- Changes don't appear until refresh

**Fixes**
- Ensure mutations invalidate queries:
  ```typescript
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['resource', projectId] })
  }
  ```
- Check query keys match exactly
- Reduce staleTime if needed (default 30s in hooks)

### Infinite Refetching Loop

**Symptoms**
- Network tab shows constant requests
- API rate limits hit

**Fixes**
- Check query key is stable (not creating new array each render)
- Disable refetch options if not needed:
  ```typescript
  useQuery({
    queryKey: ['data'],
    queryFn: fetchData,
    refetchOnWindowFocus: false,
  })
  ```

## Form Validation Issues

### Zod Validation Not Working

**Symptoms**
- Form submits with invalid data
- No validation errors shown

**Fixes**
- Check schema is imported and used
- Ensure server action validates input:
  ```typescript
  export async function createItem(input: unknown) {
    const parsed = createItemSchema.parse(input) // Will throw if invalid
  }
  ```
- For React Hook Form: use `zodResolver(schema)`

### Number Fields: "expected number, received NaN"

**Symptoms**
- Empty optional number inputs show "Invalid input: expected number, received NaN"
- Density, mass, GPS, or other numeric fields fail validation when left blank

**Root Cause**
Using `valueAsNumber: true` in `register()` converts empty strings to `NaN` (via the DOM's `input.valueAsNumber`). `NaN` is type `number` in JS but Zod's `z.number()` rejects it, and it won't match `z.string()` or `z.null()` branches either.

**Fix**
Use `setValueAs` instead of `valueAsNumber` to convert empty strings to `null`:
```typescript
// BAD - empty input becomes NaN, fails all Zod union branches
{...register("massKg", { valueAsNumber: true })}

// GOOD - empty input becomes null, non-empty becomes number
{...register("massKg", { setValueAs: (v: string) => v === "" ? null : Number(v) })}
```

And simplify the Zod schema (no need for string transform branch):
```typescript
// BAD - complex union to handle strings, numbers, and null
massKg: z.union([
  z.number().min(0),
  z.string().transform(val => val === "" ? null : parseFloat(val))
    .pipe(z.number().min(0).nullable()),
  z.null(),
]).optional().nullable()

// GOOD - setValueAs handles conversion, schema just validates
massKg: z.number().min(0, "Must be positive").nullable().optional()
```

### Optional UUID Fields: "Invalid UUID" on Empty Selection

**Symptoms**
- Optional entity select fields (e.g., linked production run, storage location) show "Invalid UUID" when left empty
- Form defaults these fields to `""` which fails `z.string().uuid()`

**Root Cause**
Schema ordering: `z.string().uuid().optional().nullable().or(emptyToNull)` tries UUID validation first on `""`, which fails. While `.or(emptyToNull)` should catch it, the error reporting can be misleading.

**Fix**
Put `emptyToNull` first in the union so empty strings are handled before UUID validation:
```typescript
import { emptyToNull } from "./helpers";

// BAD - tries UUID first, fails on "", error leaks
linkedId: z.string().uuid().optional().nullable().or(emptyToNull)

// GOOD - catches "" first, then validates UUID
linkedId: emptyToNull.or(z.string().uuid("Invalid selection")).nullable().optional()
```

### Zod v4 `.uuid()` Rejects Seed Data IDs

**Symptoms**
- EntitySelect fields (facility, reactor, feedstock) show "Please select a valid facility/reactor/feedstock" on form submit
- Values appear correctly selected in the UI but fail validation
- Multiple UUID fields fail simultaneously
- Error type is `invalid_format`, not `too_small`

**Root Cause**
Zod v4's `.uuid()` enforces strict RFC 4122 validation, checking version (position 13 must be `1`-`8`) and variant (position 17 must be `8`-`b`) bits. Zod v3 only checked the hex format pattern. Demo seed data uses sequential pseudo-UUIDs like `00000000-0000-0000-0000-000000000160` which lack valid version/variant bits and fail this stricter check.

**Fix — use a relaxed UUID-format regex in schemas**

Replace `.uuid()` with a custom regex that accepts any 8-4-4-4-12 hex string:
```typescript
// src/schemas/helpers.ts
export const uuidFormat = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Please select a valid option"
);
```

Then use `uuidFormat` instead of `z.string().uuid()` in form schemas:
```typescript
// BAD — rejects valid DB rows with non-RFC-4122 IDs
facilityId: z.string().uuid("Please select a valid facility")

// GOOD — accepts any UUID-shaped string from the database
facilityId: uuidFormat
```

**Alternative fix — make seed IDs RFC 4122 compliant**

Add version `4` and variant `a` bits to the seed helper:
```typescript
// BAD — no version/variant bits, fails Zod v4
const makeId = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`;

// GOOD — version=4, variant=a, passes Zod v4
const makeId = (n: number) => `00000000-0000-4000-a000-${n.toString().padStart(12, '0')}`;
```
After fixing, re-seed the database: `pnpm db:reset`

**Prevention**
- After Zod major version upgrades, test seed IDs against the UUID schema
- Prefer the relaxed regex if you can't guarantee all IDs are RFC 4122 compliant

## Performance Issues

### Slow Page Loads

**Symptoms**
- Time to First Byte (TTFB) > 1s
- Slow database queries

**Fixes**
- Check for N+1 queries in data-access layer
- Add database indexes for frequently queried columns
- Use `pnpm db:studio` to analyze query performance
- Consider caching with React Query staleTime
- Use `loading.tsx` for instant loading states

### Memory Leaks

**Symptoms**
- Dev server slows down over time
- Browser tab crashes

**Fixes**
- Check for event listeners not cleaned up
- Use React Query's built-in garbage collection (default 5min)
- Restart dev server periodically
- Look for large state objects in React DevTools

## Common Error Messages

### "Hydration failed"

**Cause**: Server HTML doesn't match client HTML

**Fixes**
- Check for browser-only APIs used during render (localStorage, window)
- Use `useEffect` for client-only code
- Ensure no random values in JSX (dates, Math.random)
- Use `suppressHydrationWarning` only as last resort

### "Cannot access X before initialization"

**Cause**: Circular dependency or hoisting issue

**Fixes**
- Check for circular imports between files
- Move shared types to separate file
- Use dynamic imports if needed

### "too many clients already"

**Cause**: Database connection pool exhausted

**Fixes**: See "Connection Pool Exhaustion" section above

## Getting Help

If you're still stuck:

1. **Check logs**
   - Browser console (F12)
   - Terminal where dev server runs
   - Network tab for API errors

2. **Search existing issues**
   - [Next.js Issues](https://github.com/vercel/next.js/issues)
   - [Better Auth Documentation](https://www.better-auth.com/docs)
   - [Drizzle ORM Documentation](https://orm.drizzle.team/docs)

3. **Create minimal reproduction**
   - Isolate the issue
   - Remove unrelated code
   - Share error message and code

## Prevention Checklist

Before committing:
- ✅ Run `pnpm build` to catch type errors
- ✅ Run `pnpm lint` to catch code style issues
- ✅ Test all CRUD operations
- ✅ Check nothing in .env.local committed
- ✅ Verify database migrations reviewed (if any)

Before deploying:
- ✅ Generate and review migrations (never use db:push)
- ✅ Set all env vars in hosting platform
- ✅ Test on staging environment
- ✅ Check connection pool sizes appropriate for hosting plan
- ✅ Verify admin emails configured
- ✅ Test email sending (invites, password resets)

## Related Documentation

- Architecture: `docs/architecture.md`
- Database: `docs/database.md`
- Authentication: `docs/auth.md`
- Design System: `docs/design-system.md`
- Template Usage: `TEMPLATE_USAGE.md`
