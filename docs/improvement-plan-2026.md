# noma-dmrv Improvement Plan (2026)

**Generated**: 2026-02-01
**Research Basis**: 7 comprehensive research agents covering codebase analysis, Next.js 16 best practices, security, performance, DX improvements, and production infrastructure

---

## Executive Summary

Your Next.js app template has a **solid foundation** (Next.js 16, React 19, Better Auth, good architecture) but lacks production essentials: testing, CI/CD, monitoring, and some security hardening.

This plan outlines 30+ improvements organized into 4 priority tiers, following your principle: **"Keep it simple and scalable"**.

**Estimated Timeline**: 3-4 weeks for complete transformation

---

## Current State Assessment

### ✅ Strong Foundation

- Next.js 16.1.6, React 19.2.3, Turbopack, React Compiler
- Layered architecture (components → hooks → fn → data-access → db)
- Better Auth 1.4.18 (modern choice - Auth.js team joined Better Auth in 2025)
- Auth guards at data-access layer (correct security pattern)
- Comprehensive documentation in `/docs`
- ESLint flat config (Next.js 16 requirement met)

### ❌ Critical Gaps

- **No testing** infrastructure (unit, integration, E2E)
- **No CI/CD** automation
- **No monitoring/error tracking** for production
- **No rate limiting** (brute force vulnerability)
- **No pre-commit hooks** (quality enforcement)
- Projects CRUD incomplete (stubbed in data-access layer)

### ⚠️ Security Note

**CVE-2025-29927**: Next.js middleware auth bypass vulnerability. Your template is **SAFE** because you verify auth at the data-access layer (defense in depth), but this highlights why middleware-only auth is dangerous.

---

## TIER 1: Critical - Security & Stability

### 1.1 Security Patches ⚡ 2 hours

**Problem**: Critical CVEs in Next.js ecosystem
**Solution**: Update dependencies, run security audit

```bash
pnpm update next react react-dom
pnpm audit --production
```

**Files**: `package.json`

### 1.2 Rate Limiting ⚡ 1 day

**Problem**: No protection against brute force attacks
**Solution**: Add rate limiting using `@upstash/ratelimit`

**Implementation**:

- 5 login attempts per 15 minutes per IP
- Apply to `/api/auth/*` routes and password server actions
- Edge-compatible (works without Redis initially)

**Files**: Create `src/lib/rate-limit.ts`, update auth routes

**Example**:

```typescript
// src/lib/rate-limit.ts
import { Ratelimit } from "@upstash/ratelimit";
import { kv } from "@vercel/kv";

export const rateLimitAuth = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(5, "15 m"),
});
```

### 1.3 Complete Projects CRUD ⚡ 2 days

**Problem**: Core feature stubbed - users can't manage projects
**Solution**: Implement full CRUD following items pattern

**Files**:

- `src/data-access/projects.ts` (complete TODOs)
- `src/fn/projects.ts` (add update/delete actions)
- `src/components/projects/ProjectForm.tsx` (create/edit form)

**Reference**: Use `src/data-access/items.ts` as template

### 1.4 Environment Variable Audit ⚡ 2 hours

**Problem**: Missing validation for optional production variables
**Solution**: Add monitoring vars to env schema

**Files**: `src/config/env.ts`, create `.env.production.example`

---

## TIER 2: High Priority - Production Readiness

### 2.1 Testing Infrastructure (Vitest) ⚡ 3 days

**Phase 1 - Setup** (4 hours):

```bash
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

**Phase 2 - Critical Tests** (2 days):

- Server actions validation (`src/fn/**/*.test.ts`)
- Data-access auth guards (`src/data-access/**/*.test.ts`)
- Zod schemas (`src/schemas/**/*.test.ts`)
- Utility functions (`src/lib/**/*.test.ts`)

**Goal**: 80%+ coverage on server-side code

### 2.2 E2E Testing (Playwright) ⚡ 2 days

```bash
pnpm create playwright
```

**Critical Flows**:

1. Authentication (login, password reset, email verification)
2. Project creation and navigation
3. Items CRUD operations
4. Admin user invitation

**Files**: Create `tests/e2e/` directory

### 2.3 CI/CD Pipeline (GitHub Actions) ⚡ 1 day

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm test
      - run: pnpm test:e2e
```

Create `.github/workflows/security.yml` for weekly `pnpm audit`.

### 2.4 Error Tracking (Sentry) ⚡ 4 hours

```bash
pnpm add @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

**Benefits**:

- Real-time error alerts
- Stack traces with source maps
- Performance monitoring
- Session replay

**Files**: Creates `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`

Document in new `docs/monitoring.md`

### 2.5 Database Connection Pooling ⚡ 2 hours

Review `src/db/index.ts` pool configuration:

```typescript
max: parseInt(process.env.DB_POOL_SIZE || '20'),
idleTimeoutMillis: 30000,
connectionTimeoutMillis: 10000,
```

Add `DB_POOL_SIZE` env var, document in `docs/database.md`

---

## TIER 3: Medium Priority - Developer Experience

### 3.1 Pre-commit Hooks ⚡ 2 hours

```bash
pnpm add -D husky lint-staged
pnpm dlx husky init
```

Configure `.husky/pre-commit` and `lint-staged`:

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

**Optional**: Add `commitlint` for conventional commits

### 3.2 Automated Dependency Updates (Renovate) ⚡ 1 hour

Create `.github/renovate.json`:

```json
{
  "extends": ["config:recommended"],
  "schedule": ["every weekend"],
  "packageRules": [
    {
      "matchUpdateTypes": ["patch", "minor"],
      "automerge": true
    }
  ]
}
```

Enable Renovate GitHub app.

### 3.3 Docker Setup ⚡ 1 day

**Create**:

- `Dockerfile` (multi-stage build)
- `docker-compose.yml` (PostgreSQL + Next.js for local dev)
- `.dockerignore`

Document in new `docs/deployment.md`

### 3.4 Circular Dependency Detection ⚡ 1 hour

```bash
pnpm add -D madge
```

Add script:

```json
{
  "scripts": {
    "check:circular": "madge --circular src/"
  }
}
```

Add to CI pipeline.

### 3.5 Documentation Updates ⚡ 1 day

**Create New**:

- `docs/testing.md` - Vitest + Playwright guide
- `docs/monitoring.md` - Sentry setup
- `docs/deployment.md` - Docker + production
- `docs/production-checklist.md` - Pre-deployment verification

**Update Existing**:

- `docs/security.md` - CVE-2025 notes, rate limiting, supply chain
- `docs/troubleshooting.md` - Next.js 16 issues
- `docs/database.md` - Connection pooling

---

## TIER 4: Optional Enhancements

### 4.1 Redis for Horizontal Scaling

**When**: Deploying multiple app instances
**Complexity**: High

Add `REDIS_URL` env var, implement Redis session adapter.

### 4.2 Storybook

**When**: Design team needs component playground
**Complexity**: High

Skip unless component library is extensive.

### 4.3 DevContainer

**When**: Team has inconsistent dev environments
**Complexity**: Low

Create `.devcontainer/devcontainer.json`.

### 4.4 Performance Monitoring

**When**: Need real user data
**Complexity**: Low

Enable Sentry performance monitoring, Web Vitals.

### 4.5 Advanced Caching

**When**: Have expensive operations
**Complexity**: Low

Add "use cache" directive strategically.

---

## Implementation Roadmap

### Sprint 1 (Week 1-2): Security Foundation

1. Update dependencies (2h)
2. Add rate limiting (1d)
3. Environment audit (2h)
4. Complete projects CRUD (2d)
5. Testing infrastructure setup (4h)

**Deliverable**: Secure template with complete features

### Sprint 2 (Week 3-4): Testing & Automation

1. Write critical tests (3d)
2. E2E testing setup (2d)
3. CI/CD pipeline (1d)
4. Pre-commit hooks (2h)

**Deliverable**: Automated quality gates

### Sprint 3 (Week 5): Production Ready

1. Error tracking (4h)
2. Database verification (2h)
3. Docker setup (1d)
4. Documentation updates (1d)
5. Renovate setup (1h)

**Deliverable**: Production-ready template

---

## Priority Matrix

| Priority    | Item                   | Impact | Effort | ROI   |
| ----------- | ---------------------- | ------ | ------ | ----- |
| 🔴 Critical | Security patches       | High   | Low    | ★★★★★ |
| 🔴 Critical | Rate limiting          | High   | Medium | ★★★★★ |
| 🔴 Critical | Projects CRUD          | Medium | Medium | ★★★★☆ |
| 🟠 High     | Testing infrastructure | High   | High   | ★★★★★ |
| 🟠 High     | CI/CD pipeline         | High   | Medium | ★★★★★ |
| 🟠 High     | Error tracking         | High   | Low    | ★★★★★ |
| 🟠 High     | E2E testing            | High   | Medium | ★★★★☆ |
| 🟡 Medium   | Pre-commit hooks       | Medium | Low    | ★★★★☆ |
| 🟡 Medium   | Automated updates      | Medium | Low    | ★★★★☆ |
| 🟡 Medium   | Docker setup           | Medium | Medium | ★★★☆☆ |

---

## Key Research Insights

### Next.js 16 (2025)

- ✅ params/searchParams are promises - template already handles correctly
- ⚠️ Explicit caching required - use "use cache" directive
- ✅ Turbopack default - 2-5× build speed improvement
- ✅ React Compiler - auto-memoization (no manual optimizations needed)

### Security (2025)

- **CVE-2025-29927**: Middleware auth bypass - your template is SAFE
- **CVE-2025-66478**: React Server Components RCE - patch needed
- **npm supply chain**: 1 in 35 packages has vulnerabilities
- **Rate limiting**: Essential, not optional

### Testing Stack (2025)

- **Vitest** > Jest (faster, better DX)
- **Playwright** > Cypress (E2E standard)
- **React Testing Library** (component testing)
- **Note**: Vitest doesn't support async Server Components - use Playwright

### Better Auth (2025)

- Auth.js team joined Better Auth (Sept 2025)
- Auth.js = security patches only, no new features
- Better Auth = built-in MFA, RBAC, rate limiting, multi-tenancy
- Your template can leverage these when needed

---

## Success Metrics

### Security

- ✅ Zero high/critical vulnerabilities
- ✅ Rate limiting on auth endpoints
- ✅ All env vars validated
- ✅ No secrets in git history

### Testing

- ✅ 80%+ coverage on server code
- ✅ Critical flows E2E tested
- ✅ CI passes on all PRs
- ✅ Tests run < 2 minutes

### Production

- ✅ Error tracking active
- ✅ Docker deployment tested
- ✅ Connection pooling verified
- ✅ Zero downtime deployments

### Developer Experience

- ✅ Pre-commit hooks active
- ✅ Automated updates weekly
- ✅ Documentation current
- ✅ New devs productive < 1 day

---

## Verification Steps

After implementation:

```bash
# Security
pnpm audit --production  # 0 high/critical
curl -X POST http://localhost:3100/api/auth/sign-in  # Test rate limit

# Testing
pnpm test  # 80%+ coverage
pnpm test:e2e  # All critical flows pass

# Production
docker build -t noma-dmrv .
docker run -p 3000:3000 noma-dmrv
# Verify: starts, connects to DB, no Sentry errors
```

---

## Summary

Your template has a **strong foundation** but needs production essentials:

**Must-Have** (Tier 1-2): Security, testing, CI/CD, monitoring
**Should-Have** (Tier 3): Pre-commit hooks, Docker, docs
**Nice-to-Have** (Tier 4): Redis, Storybook, advanced features

Following this plan transforms your template from a **good starting point** to a **production-ready, battle-tested foundation** that follows 2025/2026 best practices while staying **simple and scalable**.

**Total Time**: 3-4 weeks
**Result**: Production-ready template with automated quality, security, and deployment
