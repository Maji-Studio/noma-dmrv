# Console and network observations

## Environment and timeline

- Isolated in-app browser namespace: `QA-C-20260720-f977`
- Target: shared `http://localhost:3100`
- Initial `/login`: blank because Next/Turbopack rejected a generated Tailwind selector
- After the authorized one-line documentation fix: `/login` rendered normally with zero browser console errors
- Authenticated journey: organization, facility, infrastructure, feedstock, production run, and CSV attachment completed through visible UI
- Final state: browser navigation timed out; an independent `curl --max-time 10` returned connection refused because no listener remained on port 3100

## Console

Before the fix, the repeated error was:

```text
./src/app/globals.css:1374:33
Parsing CSS source code failed
border-radius: var(--radius-*);
Unexpected token Delim('*')
```

After the fix, the login and tested authenticated pages emitted no captured warning/error entries. The CSV create/re-import branch also emitted no browser-console error.

## Upload classification

The selected CSV passed client validation, was held until the production-run parent existed, and then appeared as an attached `Readings CSV · 165 B` document with an `/api/documents/{id}` link. Its parse/import phase failed closed because the run lacked an end time. The in-app browser did not expose a complete request ledger, so presign, storage PUT, and confirm/HEAD status codes are intentionally not claimed separately.

No PDF upload, Isometric request, registry mutation, removal submission, or GHG submission occurred. Credentials, authorization headers, and PII are absent from this artifact bundle.
