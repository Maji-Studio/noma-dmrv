# Sanitized browser evidence — production-run completion blocker

Route:
`/production-runs?facility=40131551-9036-48ea-9064-8ae3fde06793&run=6c82d52b-e354-49fe-9fb6-3f9db9409f96`

Record: `PR-26-001`

After selecting `Complete`, entering the end fields, blurring the time control, and
saving, the authenticated accessibility snapshot simultaneously reported:

```text
list row status: Running
dialog status option: Complete [selected]
End Date: 2027-12-02
End Time: 16:00
alert: A complete run needs an end time
```

The same valid-field save failed 4/4 times. An earlier attempt with the end fields blank
correctly produced client-side `A complete run needs an end date and time` validation and
is excluded from that count.

This excerpt is intentionally limited to non-sensitive UI state. It contains no headers,
credentials, tokens, cookies, signed URLs, or account identifiers.
