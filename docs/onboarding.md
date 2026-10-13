# Dashboard setup guide

The dashboard guides first-time setup without opening a modal on arrival.
Owners and Admins see the getting-started guide while required setup is
incomplete. Members see Setup in progress until a reactor exists, then the
ordinary dashboard.

Setup steps are derived from saved records, in this order: facility, reactor,
registry connection, supplier, feedstock intake, complete production run,
credit batch. Only the first incomplete step has a primary action. Other
incomplete steps have secondary actions, so registry setup can wait while
operations continue. Registry connection is optional and does not keep the
guide visible once all required steps are complete.

Facility and reactor actions open the existing entity forms in an
`EntitySideSheet` on the dashboard. Creating a facility selects it through
the facility context. The create hooks invalidate onboarding status, and the
guide advances after the refreshed records arrive. Registry setup opens the
shared `CertifierSettingsPanel`, also used on `/certification/settings`, with
inline project linking. A saved project link returns to the dashboard unless
replacement keys are still unsaved, in which case the discard guard warns
first. Supplier, feedstock, production run and credit batch
actions retain their facility-scoped create links to their list pages.

The registry dialog warns before discarding typed keys or an unlinked project
selection. Keep editing returns to the save or link action; Discard changes
closes without saving. Saved keys are masked, and their save-and-test action
appears only for first entry or replacement. Link project appears after a
project is selected and uses the outline style.

`useSetupGuide` owns mode, progress and collapse preference. Collapse is stored
per user and organization. The compact strip retains the active step's action
and Show guide. Editing saved records uses the normal entity edit surfaces.
