# Route-switch performance research

Date: 2026-07-28
Scope: low-risk, short-term improvements for the authenticated App Router
without changing business-data freshness semantics.

## Executive finding

The best low-hanging fix is to add a lightweight
`src/app/(app)/loading.tsx` using the existing page-header/list skeletons.
This is primarily a **perceived-latency** fix: it lets Next.js partially
prefetch the authenticated route shell and show an immediate, interruptible
fallback while the fresh destination renders. It does not make a slow server
request faster, but it removes the current “click, then nothing” interval.

Do **not** globally set `prefetch={true}` on the sidebar as the quick fix.
For dynamic routes, that requests the full route and opts its RSC payload into
the client router cache's five-minute `static` lifetime. It would also ask the
server to render many sidebar destinations that the user may never open. That
is a larger freshness/load trade-off than requested.

## Baseline before the quick patch

- The app pins Next.js `16.2.11` and React `19.2.3`
  ([package.json](../../package.json)).
- Cache Components/PPR are not enabled, and there are no `"use cache"`
  directives ([next.config.ts](../../next.config.ts),
  [modern-patterns.md](../modern-patterns.md)).
- The authenticated tree contained 34 `page.tsx` files and **zero**
  `loading.tsx` files before the recommended boundary was added.
- Its shared layout calls `requireAuth()` and `getOrgContext()`
  ([layout.tsx](../../src/app/(app)/layout.tsx)). Those reach
  `headers()` through Better Auth
  ([better-auth-server.ts](../../src/lib/auth/providers/better-auth-server.ts));
  `headers()` is a Dynamic API and opts a route into dynamic rendering
  ([Next.js `headers` reference](https://nextjs.org/docs/app/api-reference/functions/headers)).
- The sidebar exposes 22 destinations through ordinary `<Link>` elements with
  default prefetch behavior
  ([sidebar-content.tsx](../../src/components/navigation/sidebar-content.tsx)).
- Most top-level pages are thin Server Component wrappers around Client
  Components. Business data is generally requested after mount through React
  Query, whose global default `staleTime` is already 30 seconds
  ([providers.tsx](../../src/app/providers.tsx)). Some destinations also do
  request-time server work before their client view can mount; for example,
  Credit Batches and Feedstock Types resolve organization permissions, while
  Organization Settings resolves both context and profile
  ([credit-batches/page.tsx](../../src/app/(app)/credit-batches/page.tsx),
  [feedstock-types/page.tsx](../../src/app/(app)/feedstock-types/page.tsx),
  [settings/organization/page.tsx](../../src/app/(app)/settings/organization/page.tsx)).

These facts fit Next.js's documented slow-navigation case: dynamic routes are
not fully prefetched by default; without `loading.tsx`, the client may have to
wait for the server response before showing the destination. Next.js
specifically recommends adding `loading.tsx` to dynamic routes to enable
partial prefetching and immediate navigation
([Linking and Navigating](https://nextjs.org/docs/app/getting-started/linking-and-navigating),
[Prefetching guide](https://nextjs.org/docs/app/guides/prefetching)).

## Latency model: three different waits

Treat a route switch as three measurements rather than one:

1. **Click → URL/fallback changes:** router, route-chunk, Proxy, and first RSC
   response latency. This is the silent interval that `loading.tsx` targets.
2. **Fallback → destination shell:** server rendering and any Server Component
   work required before the leaf can stream.
3. **Destination shell → populated data:** client React Query actions and
   database/API work. Existing page-level skeletons already cover much of this.

A `loading.tsx` file automatically wraps the page and descendants in Suspense;
its fallback can be prefetched, navigation becomes immediate and interruptible,
and shared layouts stay interactive
([Next.js `loading.js` reference](https://nextjs.org/docs/app/api-reference/file-conventions/loading)).
It therefore improves (1) without pretending to improve (2) or (3).

The shared authenticated layout is unlikely to be the repeated page-switch
render bottleneck: Next.js preserves layouts during sibling navigation and does
not rerender them
([Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages),
[`layout.js` caveats](https://nextjs.org/docs/app/api-reference/file-conventions/layout)).
Its repeated session/org queries remain worth cleaning up for initial loads,
hard navigations, and any request where the layout is not reusable, but should
not be credited as the primary soft-navigation fix without measurements.

## Recommended quick patch

Add one lightweight boundary at `src/app/(app)/loading.tsx` so it covers the
authenticated leaf pages but leaves the persistent sidebar/mobile shell
interactive. Reuse `PageHeaderSkeleton` plus a small `TableSkeleton` or card
skeleton from
[`src/components/ui/loading-skeleton`](../../src/components/ui/loading-skeleton/index.tsx).
Keep the fallback generic, synchronous, and free of auth/business data.

Freshness impact:

- This does **not** enable Cache Components, `"use cache"`, ISR, or the Full
  Route Cache.
- Next.js's dynamic client stale time defaults to `0`; loading boundaries are
  separately reusable for the `static` period. Reusing a data-free skeleton is
  harmless, while the changing page segment still renders from fresh
  request-time input
  ([Next.js `staleTimes` reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/staleTimes)).
- Dynamically rendered page responses use private/no-cache/no-store response
  semantics rather than CDN page caching
  ([Next.js CDN caching guide](https://nextjs.org/docs/app/guides/cdn-caching)).

If the fallback is still not visible before a very fast navigation completes,
that is fine. If users need more click-local feedback under very slow networks,
`useLinkStatus` can add a subtle pending treatment inside each sidebar
`<Link>`; Next.js recommends route-level `loading.js` first
([`useLinkStatus` reference](https://nextjs.org/docs/app/api-reference/functions/use-link-status)).

## What not to bundle into the quick patch

### Global full-route prefetch

`prefetch={true}` fetches the full route for dynamic destinations. Next.js
classifies fully prefetched routes under the client router cache's five-minute
`static` lifetime, whereas dynamic segments otherwise default to zero
([`Link` prefetch reference](https://nextjs.org/docs/app/api-reference/components/link),
[`staleTimes` reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/staleTimes)).
With 22 sidebar destinations, viewport prefetch can also create unnecessary
server work; Next.js warns against broad prefetching for large link collections
([Prefetching guide](https://nextjs.org/docs/app/guides/prefetching)).

If measurement later proves route JS/RSC download—not server work or client
data—is dominant, intent-based prefetch for a few high-frequency destinations
can be evaluated separately, with explicit invalidation/freshness acceptance.

### Cache Components / PPR

These can produce a prefetched static shell around streamed dynamic sections,
but enabling them changes the rendering model and requires deliberate Suspense
and cache-lifetime design
([Cache Components](https://nextjs.org/docs/app/getting-started/partial-prerendering),
[`use cache`](https://nextjs.org/docs/app/api-reference/directives/use-cache)).
That is a long-term track, not a low-risk route-switch patch.

### Auth caching or bypasses

The current Proxy matcher covers almost every non-asset request and calls
`auth.api.getSession()`
([proxy.ts](../../src/proxy.ts),
[auth middleware](../../src/lib/auth/middleware.ts)). Better Auth's five-minute
cookie cache may make many of those calls cheap
([better-auth.ts](../../src/lib/auth/better-auth.ts)), but staging timing must
confirm that rather than assume it.

Next.js says Proxy is not intended for slow data fetching and recommends that
Proxy auth be an optimistic cookie-only check because Proxy also runs on
prefetched routes; secure authorization belongs close to the data source
([Proxy guide](https://nextjs.org/docs/app/getting-started/proxy),
[Authentication guide](https://nextjs.org/docs/app/guides/authentication)).
This repository correctly has authorization seams in `src/data-access/`, but
changing the Proxy/session contract is security-sensitive and should be a
separate measured change, not folded into the UI quick fix.

React `cache()` could deduplicate repeated auth/context work within one Server
Component render without persisting it across server requests—React invalidates
that memoization per request
([React `cache`](https://react.dev/reference/react/cache)). That is safer than a
cross-request data cache, but because the shared app layout is preserved during
soft navigation, it is more likely an initial/hard-navigation optimization.

## Verification on staging

Test a production build or staging; automatic prefetching is production-only
([Prefetching guide](https://nextjs.org/docs/app/guides/prefetching)).

For three representative sidebar switches—one thin client page, one
permission-resolving page, and Organization Settings—record:

- click → fallback/URL;
- `_rsc` request TTFB and total duration;
- fallback → page shell;
- shell → React Query data.

Success for the quick patch is immediate fallback/URL response with no change
to returned business data or its invalidation behavior. If `_rsc` TTFB remains
large, instrument Proxy/session and leaf Server Component time next. If the
shell is quick but data remains slow, investigate individual React Query/server
action waterfalls instead; uncached data can remain fresh and be streamed under
Suspense rather than being made cacheable
([Next.js Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data)).
