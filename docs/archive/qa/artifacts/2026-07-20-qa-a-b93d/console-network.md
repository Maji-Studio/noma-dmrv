# Console and network observations

Instrumentation covered every automated context and page. Raw events are retained in `raw-results*.json`.

## Product-relevant failures

- Current HEAD returned HTTP 500 for `/login` because generated Tailwind CSS was invalid. See `screenshots/server-compile-blocker.png` and the P0 finding.
- During the deliberate failed-sign-out test, `POST /api/auth/sign-out` returned the simulated 503 and Chrome logged the corresponding failed-resource message. This was expected instrumentation; importantly, protected content remained present in both tabs.

## Expected or test-induced noise

- `net::ERR_ABORTED` for map style, RSC/navigation requests, session lookup, and chunk requests occurred when the driver deliberately reloaded, navigated rapidly, or signed out. None coincided with an unexplained user-visible crash.
- One `/login` hydration mismatch in the final raw event log was caused by the evidence-capture init script replacing the signed-in account text before React hydrated. It is not counted as a product finding. Screenshots and the retained video were captured with that pre-paint redaction so no credential or account identifier is in the package.

## Negative result

Outside the deliberate 503, compile blocker, navigation aborts, and redaction artifact, no persistent unexpected browser-console exception or failed API response was observed in the completed scoped journey.
