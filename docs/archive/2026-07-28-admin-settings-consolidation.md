# Admin settings consolidation

This implementation note records the July 2026 removal of the old admin hub and
its emission-estimates tile. Read the active ADRs for the current architecture.

On 2026-07-28, the `/admin` hub and its tile linking to emission estimates were
removed. Registry configuration remains at Certification → Settings → Emissions
under ADR 0007. ADR 0015 had already made ADR 0001's genset-yield decision
vestigial; its database column and hidden round-trip field remained pending a
separate removal migration.
