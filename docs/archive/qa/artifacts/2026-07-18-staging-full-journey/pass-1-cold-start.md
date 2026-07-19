# Pass 1 — cold start and navigation

Admin role, staging. Visited 27 static/legacy routes from the 32-route inventory. Supplier/customer/credit-batch dynamic detail behavior was partially exercised with authorized visible IDs; legacy certification dynamic redirects were not exercised.

Observed: public app routes loaded without a visible 500; admin redirects behaved as expected. Most facility-scoped routes initially showed a useful EmptyState. A valid facility query did not reliably activate facility context, producing a repeatable fail. Console error/warning capture returned empty.

Result: partial pass; facility-context acceptance failed. Screenshots retained only where sanitized.
