# Isometric support questions — production data follow-up

> Ready-to-send questions arising from
> [`2026-08-04-production-data-follow-up-research.md`](./2026-08-04-production-data-follow-up-research.md)
> (researched 2026-08-04). Each is self-contained; the evidence behind every one
> is in the linked report. Project context to include when sending: Biochar
> Production and Storage Protocol v1.1 (tag 1.1.1) with Biochar Storage in
> Agricultural Soils v1.1 (tag 1.1.0), Certify project `prj_1K9YJ33RKSBX9FFF`.

**Priority order:** MS-1 (blocks evidence binding), PB-1 (blocks mass basis),
RM-1 + RM-2 (block the monitoring route), LC-1 (blocks reconciliation).

---

## 1. Production Batch mass basis

> **PB-1.** For a Biochar project under Biochar Production and Storage Protocol
> v1.1 (tag 1.1.1) with the Biochar Storage in Agricultural Soils module v1.1,
> what physical quantity and mass basis does the `mass` field on
> `POST /production_batches` represent — (a) biochar produced at the facility on
> a wet/as-produced basis, (b) biochar produced on a moisture-free dry basis,
> (c) the dry mass ultimately applied to soil, or (d) something else? The field
> carries no description in the Certify OpenAPI, in the GraphQL `ProductionBatch`
> type, or on the endpoint reference page.
>
> **PB-2.** If a single Production Batch is applied across two or more GHG-entry
> reporting periods, should `production_batches.mass` remain the full produced
> amount, or only the portion credited in that period? Given there is no
> `PATCH /production_batches/{id}`, how should a supplier correct the value if
> the applied total later diverges from the produced total?
>
> **PB-3.** Which unit strings are accepted for `production_batches.mass`? The
> OpenAPI `unit` is an unconstrained string; the protocol states `m_biochar` in
> tonnes while the sequestration blueprints show `kg` as the example unit for
> `product_mass`.
>
> **PB-4.** Is `standard_deviation` on `production_batches.mass` used in any
> calculation or uncertainty propagation, or stored as metadata only? Should it
> be omitted when mass comes from a legal-for-trade calibrated weigh scale,
> consistent with the "accurate primary data" justification in your
> sensitivity-analysis guide?
>
> **PB-5.** Is `production_batches.mass` ever reconciled by Certify against the
> sum of `truck_mass_on_arrival − truck_mass_on_departure` across that batch's
> `biochar_applications`, or against the `product_mass` datapoint on the
> sequestration component — or are these three masses independent records?
>
> **PB-6.** The `product_mass` blueprint input is documented only as "Mass of
> product", while `total_carbon_contents` / `inorganic_carbon_contents` are typed
> `Mass Fraction Dry Basis List`. Should `product_mass` be submitted as **dry**
> mass? There is no moisture-correction term in any biochar blueprint, unlike
> `biomass_burial_with_moisture_correction`. Where is the moisture measurement
> required by Ag Soils v1.1 §3.3 expected to be applied — by the supplier before
> submitting `product_mass`, or by Certify?
>
> **PB-7.** The Biochar `Production batch` measurement-sample type exposes an
> unqualified `Mass | MASS | —` property, whereas the `Biomass` type distinguishes
> `MATERIAL_CONDITION_DRY` / `MATERIAL_CONDITION_WET`. What basis does the
> unqualified property denote, and how does it relate to `production_batches.mass`?

## 2. Sample binding

> **MS-1 (highest priority).** Can `PATCH /datapoints/{id}` with **only**
> `source_ids` succeed on a datapoint whose `locked_status` is
> `locked_measurement_sample_datapoint`? If not, what is the supported way to
> attach the ISO 17025 lab report, calibration records, CRM checks, and
> raw/reduced replicate data (Ag Soils v1.1 §3.4.2–§3.5) to the exact datapoints
> consumed by the sequestration calculation, before GHG-statement submission?
>
> **MS-2.** The Production-batch property catalogue has no reflectance/R₀
> property and nothing meaning "fraction of R₀ readings above the 2 % benchmark".
> For `biochar_sequestration_1000_year*`, should `s_fraction` be (a) posted as a
> standalone `POST /datapoints`, (b) carried on a measurement sample under a
> property not shown in the public catalogue, or (c) derived by Certify from a
> reflectance property we should be sending? Where should the ≥500-measurement
> maceral-level R₀ histogram per sample be attached?
>
> **MS-3.** For `biochar_sequestration_*_unsampled`, which datapoints must
> populate `total_carbon_contents` / `inorganic_carbon_contents` /
> `h_c_molar_ratios`? Does Certify enforce the protocol's 6-month eligibility
> window, the exclusion of the batch being calculated, and the ≥30-measurement
> gate before winsorizing, or must the supplier pre-filter the `datapoint_ids`
> array? What does `WinsorizedMean(x, x)` do with fewer than 30 values?
>
> **MS-4.** What happens on `DELETE /measurement_samples/{id}` when the sample's
> datapoints are bound to a draft component, a submitted GHG statement, or a
> verified statement? Is there a guard analogous to `DELETE /datapoints/{id}`
> ("will fail if in use by a component")? Please confirm the intended ordering:
> POST corrected samples → PATCH component `datapoint_ids` →
> `POST /ghg_statements/{id}/submit` → only then DELETE the superseded sample.
>
> **MS-5.** Our project is pinned to Biochar v1.1 with Agricultural Soils v1.1.
> The catalogue describes `biochar_sequestration_1000_year_f_durable_max` as
> belonging to the Biochar Storage in **Soil Environments** module and
> `biochar_sequestration_200_year_c_org` as Agricultural Soils **v1.2**, yet
> Agricultural Soils **v1.1** §4.1.1 Option 2 defines the same 1000-year
> equation. Which blueprint keys are approved for a project certified under
> Agricultural Soils v1.1 on each durability path?
>
> **MS-6.** Project `prj_1K9YJ33RKSBX9FFF` exposes `biochar_sequestration_1000_year`
> with a single `carbon_contents` list input and `s_fraction` of quantity kind
> `dimensionless`, whereas the catalogue publishes
> `biochar_sequestration_1000_year_f_durable_max` with separate
> `total_carbon_contents` / `inorganic_carbon_contents` lists (`mg/kg`) and
> `s_fraction` as Dimensionless Ratio (`%`). Is our template on a legacy
> blueprint that should be migrated? If so, what is the migration path and its
> effect on already-submitted entries?
>
> **MS-7.** Should the sequestration `product_mass` scalar come from a
> Production-batch measurement sample `MASS` value, from
> `POST /production_batches.mass`, or from a standalone datapoint?
>
> **MS-8.** Given that CO₂-storage list inputs are exempt from sensitivity
> analysis, should `standard_deviation` be omitted on carbon-content sample
> values, or supplied for the data-quality assessment even though it is excluded
> from variance propagation?
>
> **MS-9.** `MeasurementSample.measured_at` is typed `date` on the response while
> the request accepts `date-time`. Is time-of-day discarded on write, or only on
> read-back?

## 3. Reactor monitoring

> **RM-1.** For a Biochar v1.1 project using Agricultural Soils v1.1, which
> channel does Isometric expect for pyrolysis reactor monitoring data:
> `POST /measurement_samples` with `measurement_type: "pyrolysis_reactor"`, the
> Sensors + Parquet time-series pipeline
> (`biochar_pyrolysis_reactor_facility_time_series`), a defined combination of
> both, or something else? If a combination, which data belongs to which channel?
>
> **RM-2.** The Field measurements guide states Pyrolysis reactor samples are
> required for all Biochar projects, but the Adding measurement samples guide
> publishes no measurement-property table for `pyrolysis_reactor`. Please publish
> or send the allowed `measurement_property` (quantity kind + qualifier) list and
> expected units. Do the `pyrolysis_reactor_emissions` and `flue_stack_emissions`
> qualifiers belong to this type?
>
> **RM-3.** What is the expected cadence and grain of a `pyrolysis_reactor`
> measurement sample — one per production batch, one per reporting period, or one
> per discrete flue-gas analysis? Should `production_batch_id` be populated?
> Should `measurement_location_id` be non-null for a reactor?
>
> **RM-4.** The Uploading time series data guide states time-series data "can
> currently be associated with either a Direct Air Capture (DAC) capture facility
> or a DAC storage location (saline aquifer)", yet the same page publishes
> Biochar Pyrolysis Reactor and WAE property tables and the live OpenAPI accepts
> `biochar_pyrolysis_reactor_facility_time_series`. Is Biochar time-series upload
> supported for production submissions today? Is it enabled for project
> `prj_1K9YJ33RKSBX9FFF`? If yes, please correct the guide's introduction.
>
> **RM-5.** Protocol v1.1 §9.2.2 requires continuous gas mass flow rate (t/h) at
> ≥1-minute intervals for the continuous direct-emissions route, but the Biochar
> Pyrolysis Reactor time-series property table publishes no flow-rate property
> (unlike the DAC tables). How should a Biochar project submit gas flow rate?
> Will `MASS_FLOW_RATE` be accepted on a Biochar reactor sensor?
>
> **RM-6.** §9.1.2 and §9.2.2 require raw 1-minute data retained ≥5 years and
> "made available upon request". Does Isometric expect the raw series to be
> uploaded, or only aggregated Parquet rows with raw data retained supplier-side
> and produced on VVB request? If aggregated, what aggregation period is expected
> for reactor pressure, temperature and composition?
>
> **RM-7.** §3.4.3 sends reactor calibration records to the VVB and the PDD, and
> §6.6 (Data Sharing) is a publication rule, not an upload gate. Where should
> reactor sensor calibration certificates, accuracy specifications and
> manufacturer manuals be attached in Certify — as Sources bound to sample
> datapoints, as Sources on the PDD, or elsewhere? Neither the Sensor nor the
> DataUploadSubmission resource exposes an evidence/source field.
>
> **RM-8.** Please confirm that Monitoring Submissions are **not** the channel
> for Biochar pyrolysis reactor monitoring under agricultural-soils v1.1, and
> that no monitoring requirements will be generated for this project. The
> Storage monitoring guide lists monitoring submissions as configured for
> salt-cavern, subsurface-biomass and permeable-reservoirs modules only, and
> `ProjectMonitoringRequirement` has no facility field.
>
> **RM-9.** The Biochar time-series table includes N₂O mass fraction, but
> protocol §9.2.2 requires composition for CH₄, H₂, CO and CO₂ only. Is N₂O
> expected, optional, or vestigial for a v1.1 project?
>
> **RM-10.** Reactor monitoring volume under v1.1 depends on the chosen gas-loss
> route (§9.1.2) and direct-emissions route (§9.2.2 vs §9.2.4). Does the expected
> Certify submission channel or payload change with those choices, and should the
> chosen routes be recorded anywhere in Certify beyond the PDD?

## 4. Lifecycle

> **LC-1.** The `supplier-reference-id` guide says supplier reference IDs can be
> used on multi-object GET endpoints, but the live OpenAPI for
> `GET /measurement_samples` and `GET /production_batches` exposes only cursor
> pagination. Is this a spec omission or a doc error? If the filter is
> unsupported, how should a supplier recover the Isometric ID of a measurement
> sample when a POST response is lost? There is also no
> `GET /measurement_samples/{id}`, so a full paginated scan at 50/page is
> currently the only option. Can `project_id`, `production_batch_id`,
> `measurement_type`, `supplier_reference_id` and date filters be added?
>
> **LC-2.** What is the supported way to correct a `production_batch` or a
> `measurement_sample` after creation — delete and re-create under a new
> `supplier_reference_id`, delete and re-create under the same one, or a support
> ticket?
>
> **LC-3.** `DELETE /datapoints/{id}` and `DELETE /components/{id}` document
> in-use failure conditions; `DELETE /measurement_samples/{id}` and
> `DELETE /production_batches/{id}` document none. Does deleting a measurement
> sample delete or orphan the datapoints it minted? Is it refused if those
> datapoints are inputs to a component or a submitted GHG entry? Does deleting a
> production batch null out `production_batch_id` on referencing measurement
> samples, or is it refused?
>
> **LC-4.** Does `pending_total_co2e_removed_kg` become non-null for
> measurement-sample and production-batch changes (create/delete), or only for
> datapoint/component/removal PATCHes? This determines whether we can rely on it
> as the sole "needs resubmission" signal.
>
> **LC-5.** There is no PATCH or DELETE for sensors. Is that intentional? How do
> we correct a sensor created with a wrong `reference`, `units`, or measurement
> property?
>
> **LC-6.** How do we correct or supersede an already-processed data upload
> submission? What happens when a second submission covers an overlapping time
> window for the same `sensor_reference` — replace, merge, duplicate, or error?
