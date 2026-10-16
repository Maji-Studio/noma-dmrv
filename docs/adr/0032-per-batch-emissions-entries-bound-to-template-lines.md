# Operating emissions are entered per credit batch and bound to Removal-template lines

**Status: Proposed** (2026-10-15). [Plan](../plans/2026-10-15-template-driven-emissions.md). Supersedes the operating-emissions half of [ADR 0018](./0018-isometric-owns-project-emissions.md) and the 2026-07-27 non-goals on #291. Amends [ADR 0020](./0020-production-emissions-front-loaded-per-credit-batch.md) and [ADR 0031](./0031-operator-energy-estimates.md).

## Context

ADR 0018 keeps every emission that noma does not record on a production run out of Removals. It treats staff travel, lab electricity, sampling consumables and pyrolyzer direct emissions as project-scope tuples, and `PERIOD_INPUT_TUPLES` stops them reaching a Removal datapoint. #1020 (2026-10-14) would have moved those lines to project-level components in Isometric.

The target production template, "LCA based template Cula" (`rvt_1M2QJGQS21S0A8H5`), puts them on every Removal instead. Isometric's own sources point the same way:

- Biochar v1.1, Net CDR Calculation > Calculation of CO2eOperations, RP: "CO2eOperations, RP emissions must be attributed to the Reporting Period in which they occur. Allocation may be permitted in certain instances, on a case by case basis, in agreement with Isometric." The protocol's operations table includes MRV sampling and lab analysis, staff travel and direct emissions.
- docs.isometric.com, user-guides/certify/project-emissions: project-level components are for "Project establishment and end-of-life phases".
- docs.isometric.com, user-guides/certify/lca: "For credit verifications, monitored inputs require ex-post measured values for the specific reporting period as well as supporting evidence for the use of the value."

The quotes were read through the Isometric MCP on 2026-10-15; the registry text at https://registry.isometric.com/protocol/biochar/1.1 is authoritative.

noma records none of these numbers, so the template cannot be filled. The #291 decision of 2026-07-27 also ruled out the two things a fix needs: a local copy of the template, and forms built from it.

## Decision

1. **Emissions entries.** An operator records each operating emission as an entry on exactly one credit batch, with its evidence. An entry is bound to a template line by template ID, component ID and input key, never by display name. Entries can be edited until a Removal sends them.
2. **On top of automatic sources.** An entry on a line noma also fills from records (run diesel, run kWh) adds to the automatic figure, and the sum is sent. Lines whose inputs combine by multiplying, or that hold readings, take at most one entry per batch: gas concentration with mass flow, and meter readings. Paired inputs are never summed one input at a time, so a Removal that would group two such entries for the same line is refused.
3. **Recorded zeros.** A line with nothing entered shows "Not recorded" on the batch and on the Removal, never 0. The Removal flow confirms all empty lines in one step and records a zero per line, with who and when. A Removal-confirmed zero belongs to the Removal that confirmed it and is never sent by another. An unconfirmed empty line blocks submission. noma never sends a zero nobody confirmed.
   - **2026-10-16 decision:** operators may mark a line "Nothing to record" at any time with an optional note when no counting values or positive automatic figure exist. These zeros have no draft Removal owner, need no evidence, and are tombstoned with activity when a value is added.
4. **Evidence is required for certification.** An entry without a file blocks the Removal. Recorded zeros need no file, and fixed template factors are never asked for. Files reach Isometric as Sources on the exact datapoint.
5. **Each credit batch keeps its template.** A batch pins the facility's default Removal template when it is created. Changing the default never moves existing batches.
6. **Template copies.** noma stores each normalized template definition it observes, with a fingerprint. A change review compares the copy that entries were written against with the current one, and flags removed, changed and added lines.
   - Entries on a removed or changed line stop counting until someone reviews them.
   - Which record or entry fills each line is assigned by component ID. The three known templates are bootstrapped, surviving IDs carry forward, and new IDs are assigned in the review.
   - Each line's reviewed contract states its scope (operating, forbidden or unassigned), an optional automatic source, and its entry policy (none, additive or single). Only operating lines whose policy allows entries accept them.
7. **Forms per input type, not a form engine.** The supported shapes are fuel volume, electricity, meter readings, mass, distance, mass × distance and gas concentration with mass flow. Any other monitored shape shows "Needs setup" and blocks.
8. **When an entry is sent.** An entry goes out once. Only a Removal that is not yet submitted, or one whose correction window is open (decision 9), can take a new entry, and only when the entry's date falls in the Removal's window (the batch start date to that Removal's latest application, compared as calendar dates). This window is not the GHG Statement's reporting period. An existing reservation or claim wins; otherwise the eligible Removal with the earliest window end, then the earliest draft creation, then the lowest id takes it. A retry or supersede of that Removal keeps it. If no Removal of the batch can carry it, it goes on the facility's next Removal whose window covers its date (plan §7, #1059). A submitted Removal is not corrected for it.
9. **Corrections only after Isometric changes the state.** noma never corrects a submitted Removal on its own initiative, and the entries it sent stay locked.
   - Edits reopen when a statement covering the lineage fails verification, or is back in DRAFT after noma submitted it to the verifier. A statement noma only created is DRAFT too, so the reopen needs a recorded verifier submission, not the statement's creation.
   - No other statement covering the lineage may be awaiting verification, verified or issued. Status is freshly read; unknown fails closed, nothing may be in flight, and the edit runs under the lineage locks.
   - The edited Removal shows "correction needed", and resubmitting supersedes it.

## What stays from earlier decisions

- **ADR 0018:**
  - The journal deletion stands. Entries are per-batch evidence-backed measurements, not a period journal.
  - Establishment and end-of-life lines stay project-level in Isometric and stay forbidden on Removals. The scope guard keeps those tuples; it releases a tuple only for a line whose reviewed contract is `operating` with an automatic source or an entry policy other than `none`.
  - The `Safety margin` carve-out stands.
- **ADR 0020:**
  - Production-bucket record totals are still sent in full on the batch's claiming Removal.
  - Entries get their own claim per entry, so a follow-up Removal can send entries without resending run totals.
- **ADR 0031:** estimates stay display only.

## Consequences

- noma becomes the system of record for these numbers and their evidence, as it already is for runs and samples.
- `MAPPING_REVISION` changes, which supersedes earlier Removal versions. This is acceptable before production.
- Sample transport legs stop feeding Removals. Sample shipping is entered per line instead, so two lab lines can no longer receive the same total.
- Shared or allocated entries across batches stay out of scope. A project-wide flight goes on one batch the operator picks.
