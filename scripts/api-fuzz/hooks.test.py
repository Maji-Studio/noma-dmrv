"""Offline tests. Run with the same Schemathesis 4.29.3 Python environment."""

import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

import schemathesis
from hypothesis import given, settings
from requests import Request
from schemathesis.config import SchemathesisConfig
from schemathesis.core.parameters import ParameterLocation
from schemathesis.generation import GenerationMode
from schemathesis.generation.drivers import ExamplesGenerator
from schemathesis.generation.feedback import FeedbackSources
from schemathesis.generation.meta import CaseMetadata, ComponentInfo, GenerationInfo, PhaseInfo, CoverageScenario, StatefulPhaseData, TestPhase
from schemathesis.generation.overrides import for_operation
from schemathesis.hooks import GLOBAL_HOOK_DISPATCHER, HookContext
from schemathesis.specs.openapi.coverage._operation import iter_coverage_cases
from schemathesis.specs.openapi.checks import missing_required_header, negative_data_rejection, positive_data_acceptance

FIXTURE_ID = "11111111-1111-4111-8111-111111111111"
FIXTURE_NOW = datetime(2026, 10, 9, tzinfo=timezone.utc)
RUN_BIN_ID = "22222222-2222-4222-8222-222222222222"
FEEDSTOCK_ETAG = '"2.3"'
RUN_ETAG = '"4.5"'
PRODUCT_BIN_ID = "33333333-3333-4333-8333-333333333333"
PRODUCT_ETAG = '"6.7"'
LAB_SAMPLE_ETAG = '"8.9"'
ORDER_ETAG = '"10.1"'
DELIVERY_ETAG = '"12.1"'
DELETE_ORDER_ETAG = '"11.1"'
DELETE_ORDER_ID = "44444444-4444-4444-8444-444444444444"
CUSTOMER_LOCATION_ID = "55555555-5555-4555-8555-555555555555"
FLOAT_MULTIPLE_OF_ARTIFACT = 330796.723
TARGET_KINDS = ("FACILITY", "SUPPLIER", "FEEDSTOCK_TYPE", "BIN", "DRIVER", "VEHICLE", "FEEDSTOCK", "REACTOR", "PRODUCTION_RUN", "BIOCHAR_BIN", "BIOCHAR_PRODUCT", "PURE_FORMULATION", "CREDIT_BATCH", "LAB_SAMPLE", "CUSTOMER", "ORDER", "DELIVERY")
for kind in TARGET_KINDS:
    os.environ[f"API_FUZZ_{kind}_ID"] = FIXTURE_ID
os.environ.update(
    API_FUZZ_DELIVERY_ETAG=DELIVERY_ETAG,
    API_FUZZ_ORDER_ETAG=ORDER_ETAG, API_FUZZ_DELETE_ORDER_ETAG=DELETE_ORDER_ETAG,
    API_FUZZ_DELETE_ORDER_ID=DELETE_ORDER_ID, API_FUZZ_CUSTOMER_LOCATION_ID=CUSTOMER_LOCATION_ID,
    API_FUZZ_BASE_URL="http://localhost/api/v1", API_FUZZ_KEY="offline-placeholder",
    API_FUZZ_FEEDSTOCK_ETAG=FEEDSTOCK_ETAG, API_FUZZ_PRODUCTION_RUN_ETAG=RUN_ETAG, API_FUZZ_RUN_BIN_ID=RUN_BIN_ID,
    API_FUZZ_PRODUCT_BIN_ID=PRODUCT_BIN_ID, API_FUZZ_BIOCHAR_PRODUCT_ETAG=PRODUCT_ETAG, API_FUZZ_LAB_SAMPLE_ETAG=LAB_SAMPLE_ETAG,
)
config = SchemathesisConfig.from_path("schemathesis.toml")
with patch("datetime.datetime", wraps=datetime) as fixture_clock:
    fixture_clock.now.return_value = FIXTURE_NOW
    schema = schemathesis.openapi.from_path("openapi/v1.json", config=config)


def hook(name):
    return GLOBAL_HOOK_DISPATCHER.get_all_by_name(name)[0]


class HarnessTests(unittest.TestCase):
    def test_actual_examples_driver_reaches_all_seeded_targets_and_create(self):
        seeded = []
        for result in schema.get_all_operations():
            operation = result.ok()
            cases = ExamplesGenerator(operation=operation, as_strategy_kwargs={}, feedback=FeedbackSources(), fill_missing=False)
            seeded.extend(case for case in cases if case.meta.phase.data.description.startswith("Seeded fixture"))
        # 32 by-id targets (the stock-movement create is one of them), the feedstock
        # create and its oversize twin, the run create, the product create, the
        # lab sample create, order create and delivery create.
        self.assertEqual(len(seeded), 39)
        stock = next(case for case in seeded if case.operation.label == "GET /storage-locations/{idOrCode}/stock")
        self.assertEqual(stock.path_parameters, {"idOrCode": FIXTURE_ID})
        self.assertTrue(stock.meta.generation.mode.is_positive)
        create = next(case for case in seeded if case.operation.label == "POST /feedstocks" and case.meta.generation.mode.is_positive)
        self.assertEqual(create.query, {"dryRun": "true"})
        self.assertTrue(create.headers["Idempotency-Key"])
        self.assertTrue(create.meta.generation.mode.is_positive)
        for field in ("facilityId", "supplierId", "feedstockTypeId"):
            self.assertEqual(create.body[field], FIXTURE_ID)
        self.assertEqual(create.body["allocations"][0]["storageLocationId"], FIXTURE_ID)
        # hooks.py binds the real clock at import, so the fixed FIXTURE_NOW never applied.
        self.assertEqual(create.body["deliveryDate"], datetime.now(timezone.utc).date().isoformat())
        self.assertEqual(create.body["totalWetMassKg"], sum(allocation["allocatedWetMassKg"] for allocation in create.body["allocations"]))
        original = create.operation.definition.raw["requestBody"]["content"]["application/json"]["example"]
        self.assertNotEqual(original["facilityId"], FIXTURE_ID)

    def test_seeded_run_create_is_a_valid_dry_run_on_the_seeded_bin(self):
        operation = schema["/production-runs"]["POST"]
        cases = ExamplesGenerator(operation=operation, as_strategy_kwargs={}, feedback=FeedbackSources(), fill_missing=False)
        seeded = [case for case in cases if case.meta.phase.data.description.startswith("Seeded fixture")]
        self.assertEqual(len(seeded), 1)
        case = seeded[0]
        self.assertTrue(case.meta.generation.mode.is_positive)
        self.assertEqual(case.query, {"dryRun": "true"})
        self.assertTrue(case.headers["Idempotency-Key"])
        self.assertEqual(case.body["facilityId"], FIXTURE_ID)
        self.assertEqual(case.body["reactorId"], FIXTURE_ID)
        self.assertEqual(case.body["feedstockDraws"], [{"storageLocationId": RUN_BIN_ID, "wetMassKg": 10}])
        self.assertNotIn("endTime", case.body)
        started = datetime.fromisoformat(case.body["startTime"])
        self.assertIsNotNone(started.utcoffset())
        # One hour ago, after seed.ts closed its run 2 to 3 hours ago.
        age = datetime.now(timezone.utc) - started
        self.assertLess(abs(age - timedelta(hours=1)), timedelta(minutes=5))
        original = operation.definition.raw["requestBody"]["content"]["application/json"]["example"]
        self.assertNotEqual(original["facilityId"], FIXTURE_ID)

    def test_seeded_product_create_is_a_valid_dry_run_on_the_seeded_bins(self):
        operation = schema["/biochar-products"]["POST"]
        cases = ExamplesGenerator(operation=operation, as_strategy_kwargs={}, feedback=FeedbackSources(), fill_missing=False)
        seeded = [case for case in cases if case.meta.phase.data.description.startswith("Seeded fixture")]
        self.assertEqual(len(seeded), 1)
        case = seeded[0]
        self.assertTrue(case.meta.generation.mode.is_positive)
        self.assertEqual(case.query, {"dryRun": "true"})
        self.assertTrue(case.headers["Idempotency-Key"])
        for field in ("facilityId", "formulationId", "sourceBiocharStorageLocationId"):
            self.assertEqual(case.body[field], FIXTURE_ID)
        self.assertEqual(case.body["storageLocationId"], PRODUCT_BIN_ID)
        self.assertEqual(case.body["ingredients"], [])
        self.assertEqual(case.body["waterAddedKg"], 0)
        placed = datetime.fromisoformat(case.body["placedAt"])
        self.assertIsNotNone(placed.utcoffset())
        # After the seeded product (4 hours ago) and loss (3.5 hours ago), before now.
        age = datetime.now(timezone.utc) - placed
        self.assertLess(abs(age - timedelta(minutes=30)), timedelta(minutes=5))
        original = operation.definition.raw["requestBody"]["content"]["application/json"]["example"]
        self.assertNotEqual(original["facilityId"], FIXTURE_ID)

    def test_seeded_lab_sample_create_is_a_valid_dry_run_on_the_seeded_batch(self):
        operation = schema["/lab-samples"]["POST"]
        cases = ExamplesGenerator(operation=operation, as_strategy_kwargs={}, feedback=FeedbackSources(), fill_missing=False)
        seeded = [case for case in cases if case.meta.phase.data.description.startswith("Seeded fixture")]
        self.assertEqual(len(seeded), 1)
        case = seeded[0]
        self.assertTrue(case.meta.generation.mode.is_positive)
        self.assertEqual(case.query, {"dryRun": "true"})
        self.assertTrue(case.headers["Idempotency-Key"])
        self.assertEqual(case.body["creditBatchId"], FIXTURE_ID)
        # A sampling instant with an offset, shortly before now and never in the future.
        sampled = datetime.fromisoformat(case.body["samplingTime"])
        self.assertIsNotNone(sampled.utcoffset())
        age = datetime.now(timezone.utc) - sampled
        self.assertLess(abs(age - timedelta(minutes=30)), timedelta(minutes=5))
        # The published example carries only 200-year fields: no R0 or TGA evidence.
        for field in ("randomReflectanceR0Percent", "sReflectanceFraction", "residualCarbonPercent", "reactiveCarbonPercent"):
            self.assertNotIn(field, case.body)
        original = operation.definition.raw["requestBody"]["content"]["application/json"]["example"]
        self.assertNotEqual(original["creditBatchId"], FIXTURE_ID)

    def test_seeded_lab_sample_patch_and_delete_use_the_etag_and_a_real_change(self):
        patch_operation = schema["/lab-samples/{idOrCode}"]["PATCH"]
        examples = []
        hook("before_add_examples")(HookContext(operation=patch_operation), examples)
        self.assertEqual(len(examples), 1)
        self.assertEqual(examples[0].headers["If-Match"], LAB_SAMPLE_ETAG)
        self.assertEqual(examples[0].query, {"dryRun": "true"})
        self.assertEqual(examples[0].path_parameters, {"idOrCode": FIXTURE_ID})
        self.assertTrue(examples[0].body)
        delete_examples = []
        hook("before_add_examples")(HookContext(operation=schema["/lab-samples/{idOrCode}"]["DELETE"]), delete_examples)
        self.assertEqual(len(delete_examples), 1)
        self.assertEqual(delete_examples[0].headers["If-Match"], LAB_SAMPLE_ETAG)
        self.assertEqual(delete_examples[0].query, {"dryRun": "true"})
        self.assertEqual(delete_examples[0].body, {})

    def test_seeded_order_create_uses_fixture_references_and_calendar_date(self):
        operation = schema["/orders"]["POST"]
        cases = ExamplesGenerator(operation=operation, as_strategy_kwargs={}, feedback=FeedbackSources(), fill_missing=False)
        seeded = [case for case in cases if case.meta.phase.data.description.startswith("Seeded fixture")]
        self.assertEqual(len(seeded), 1)
        case = seeded[0]
        self.assertTrue(case.meta.generation.mode.is_positive)
        self.assertEqual(case.query, {"dryRun": "true"})
        self.assertTrue(case.headers["Idempotency-Key"])
        for field in ("facilityId", "customerId", "formulationId"):
            self.assertEqual(case.body[field], FIXTURE_ID)
        self.assertEqual(case.body["customerLocationId"], CUSTOMER_LOCATION_ID)
        self.assertEqual(case.body["orderDate"], datetime.now(timezone.utc).date().isoformat())
        self.assertGreater(case.body["quantityKg"], 0)
        original = operation.definition.raw["requestBody"]["content"]["application/json"]["example"]
        self.assertNotEqual(original["customerId"], FIXTURE_ID)

    def test_order_patch_and_delete_use_separate_targets_and_etags(self):
        for method, target, etag, body in (
            ("PATCH", FIXTURE_ID, ORDER_ETAG, {"packaging": "bagged"}),
            ("DELETE", DELETE_ORDER_ID, DELETE_ORDER_ETAG, {}),
        ):
            operation = schema["/orders/{idOrCode}"][method]
            examples = []
            hook("before_add_examples")(HookContext(operation=operation), examples)
            self.assertEqual(len(examples), 1)
            case = examples[0]
            self.assertTrue(case.meta.generation.mode.is_positive)
            self.assertEqual(case.path_parameters, {"idOrCode": target})
            self.assertEqual(case.headers["If-Match"], etag)
            self.assertEqual(case.query, {"dryRun": "true"})
            self.assertEqual(case.body, body)

    def test_seeded_delivery_create_and_patch_are_small_metadata_safe_dry_runs(self):
        operation = schema["/deliveries"]["POST"]
        cases = ExamplesGenerator(operation=operation, as_strategy_kwargs={}, feedback=FeedbackSources(), fill_missing=False)
        seeded = [case for case in cases if case.meta.phase.data.description.startswith("Seeded fixture")]
        self.assertEqual(len(seeded), 1)
        case = seeded[0]
        self.assertTrue(case.meta.generation.mode.is_positive)
        self.assertEqual(case.query, {"dryRun": "true"})
        self.assertTrue(case.headers["Idempotency-Key"])
        self.assertEqual(case.body["orderId"], FIXTURE_ID)
        self.assertEqual(case.body["storageLocationId"], PRODUCT_BIN_ID)
        self.assertEqual(case.body["deliveredWetMassKg"], 0.1)
        self.assertEqual(case.body["moisturePercent"], 10)
        delivered = datetime.fromisoformat(case.body["deliveredAt"])
        self.assertIsNotNone(delivered.utcoffset())
        self.assertLess(abs(datetime.now(timezone.utc) - delivered - timedelta(minutes=30)), timedelta(minutes=5))
        examples = []
        hook("before_add_examples")(HookContext(operation=schema["/deliveries/{idOrCode}"]["PATCH"]), examples)
        self.assertEqual(len(examples), 1)
        patch_case = examples[0]
        self.assertEqual(patch_case.path_parameters, {"idOrCode": FIXTURE_ID})
        self.assertEqual(patch_case.headers["If-Match"], DELIVERY_ETAG)
        self.assertEqual(patch_case.query, {"dryRun": "true"})
        self.assertEqual(patch_case.body, {"distanceNote": "API fuzz delivery note"})

    def test_seeded_movement_create_pins_the_bin_and_posts_a_recent_loss(self):
        operation = schema["/storage-locations/{idOrCode}/stock-movements"]["POST"]
        cases = ExamplesGenerator(operation=operation, as_strategy_kwargs={}, feedback=FeedbackSources(), fill_missing=False)
        seeded = [case for case in cases if case.meta.phase.data.description.startswith("Seeded fixture")]
        self.assertEqual(len(seeded), 1)
        case = seeded[0]
        self.assertTrue(case.meta.generation.mode.is_positive)
        self.assertEqual(case.path_parameters, {"idOrCode": FIXTURE_ID})
        self.assertEqual(case.query, {"dryRun": "true"})
        self.assertTrue(case.headers["Idempotency-Key"])
        self.assertEqual(case.body["kind"], "loss")
        occurred = datetime.fromisoformat(case.body["occurredAt"])
        self.assertLess(abs(datetime.now(timezone.utc) - occurred - timedelta(hours=1)), timedelta(minutes=5))
        original = operation.definition.raw["requestBody"]["content"]["application/json"]["example"]
        self.assertNotEqual(original["occurredAt"], case.body["occurredAt"])

    def test_seeded_product_patch_sends_the_published_body_and_etag(self):
        operation = schema["/biochar-products/{idOrCode}"]["PATCH"]
        examples = []
        hook("before_add_examples")(HookContext(operation=operation), examples)
        self.assertEqual(len(examples), 1)
        self.assertEqual(examples[0].headers["If-Match"], PRODUCT_ETAG)
        self.assertEqual(examples[0].query, {"dryRun": "true"})
        self.assertEqual(examples[0].body, operation.definition.raw["requestBody"]["content"]["application/json"]["example"])
        self.assertTrue(examples[0].body)

    def test_seeded_oversize_create_requires_413(self):
        operation = schema["/feedstocks"]["POST"]
        cases = ExamplesGenerator(operation=operation, as_strategy_kwargs={}, feedback=FeedbackSources(), fill_missing=False)
        case = next(case for case in cases if case.meta.phase.data.description == "Seeded fixture oversize create")
        self.assertTrue(case.meta.generation.mode.is_negative)
        self.assertEqual(case.query, {"dryRun": "true"})
        self.assertTrue(case.headers["Idempotency-Key"])
        self.assertEqual(case.body["facilityId"], FIXTURE_ID)
        serialized = case.as_transport_kwargs(headers=schema.config.headers)
        check = hook("after_load_schema").__globals__["seeded_oversize_rejection"]
        body_limit = check.__globals__["API_BODY_MAX_BYTES"]
        self.assertGreater(len(json.dumps(serialized["json"]).encode("utf-8")), body_limit)
        self.assertIsNone(check(None, SimpleNamespace(status_code=413), case))
        for status in (201, 400, 414, 422, 500):
            with self.assertRaisesRegex(AssertionError, "must return 413"):
                check(None, SimpleNamespace(status_code=status), case)
        ordinary = operation.Case(body={}, media_type="application/json")
        self.assertIsNone(check(None, SimpleNamespace(status_code=201), ordinary))
        original = operation.definition.raw["requestBody"]["content"]["application/json"]["example"]
        self.assertLess(len(original.get("notes", "")), body_limit)

    @settings(max_examples=5, database=None, deadline=None)
    @given(schema["/feedstocks"]["POST"].as_strategy(generation_mode=GenerationMode.POSITIVE))
    def test_seeded_create_does_not_pin_generated_references(self, case):
        hook("before_call")(HookContext(operation=case.operation), case)
        self.assertNotEqual(case.body["facilityId"], FIXTURE_ID)
        self.assertFalse(for_operation(schema.config, operation=case.operation).query)

    def test_seeded_examples_do_not_pin_random_generation(self):
        count = 0
        for result in schema.get_all_operations():
            operation = result.ok()
            if "{idOrCode}" not in operation.path:
                continue
            examples = []
            hook("before_add_examples")(HookContext(operation=operation), examples)
            self.assertEqual(len(examples), 1, operation.label)
            target = DELETE_ORDER_ID if operation.label == "DELETE /orders/{idOrCode}" else FIXTURE_ID
            self.assertEqual(examples[0].path_parameters, {"idOrCode": target})
            if operation.method.upper() == "POST":
                # The stock-movement create: a dry run with its own key.
                self.assertEqual(examples[0].query, {"dryRun": "true"})
                self.assertTrue(examples[0].headers["Idempotency-Key"])
            self.assertTrue(examples[0].meta.generation.mode.is_positive)
            self.assertEqual(examples[0].meta.phase.name.value, "examples")
            self.assertFalse(for_operation(schema.config, operation=operation).path_parameters)
            self.assertFalse("If-Match" in for_operation(schema.config, operation=operation).headers)
            if operation.method.upper() in {"PATCH", "DELETE"}:
                self.assertEqual(examples[0].query, {"dryRun": "true"})
                etags = {"/deliveries/": DELIVERY_ETAG, "/production-runs/": RUN_ETAG, "/biochar-products/": PRODUCT_ETAG, "/lab-samples/": LAB_SAMPLE_ETAG, "/orders/": DELETE_ORDER_ETAG if operation.method.upper() == "DELETE" else ORDER_ETAG}
                etag = etags.get(next((prefix for prefix in etags if operation.path.startswith(prefix)), ""), FEEDSTOCK_ETAG)
                self.assertEqual(examples[0].headers["If-Match"], etag)
            count += 1
        self.assertEqual(count, 32)

    def test_seeded_positive_examples_must_return_2xx(self):
        check = hook("after_load_schema").__globals__["seeded_example_success"]
        for label in ("GET /feedstocks/{idOrCode}", "GET /production-runs/{idOrCode}", "PATCH /production-runs/{idOrCode}", "GET /biochar-products/{idOrCode}", "PATCH /biochar-products/{idOrCode}", "GET /credit-batches/{idOrCode}", "GET /lab-samples/{idOrCode}", "PATCH /lab-samples/{idOrCode}", "DELETE /lab-samples/{idOrCode}", "GET /deliveries/{idOrCode}", "PATCH /deliveries/{idOrCode}", "GET /customers/{idOrCode}", "GET /customers/{idOrCode}/locations", "GET /orders/{idOrCode}", "GET /orders/{idOrCode}/balance", "PATCH /orders/{idOrCode}", "DELETE /orders/{idOrCode}"):
            method, path = label.split(" ")
            operation = schema[path][method]
            examples = []
            hook("before_add_examples")(HookContext(operation=operation), examples)
            case = examples[0]
            for status in (200, 201, 204):
                self.assertIsNone(check(None, SimpleNamespace(status_code=status), case))
            for status in (301, 400, 401, 404, 409, 422, 428, 500):
                with self.assertRaisesRegex(AssertionError, "must return 2xx"):
                    check(None, SimpleNamespace(status_code=status), case)
        for label in ("POST /feedstocks", "POST /production-runs", "POST /biochar-products", "POST /lab-samples", "POST /orders", "POST /deliveries", "POST /storage-locations/{idOrCode}/stock-movements"):
            method, path = label.split(" ")
            examples = []
            hook("before_add_examples")(HookContext(operation=schema[path][method]), examples)
            positive = next(case for case in examples if case.meta.generation.mode.is_positive)
            self.assertIsNone(check(None, SimpleNamespace(status_code=200), positive))
            with self.assertRaisesRegex(AssertionError, "must return 2xx"):
                check(None, SimpleNamespace(status_code=409), positive)
        # Generated and non-example cases keep the ordinary status allowances.
        ordinary = schema["/facilities/{idOrCode}"]["GET"].Case(path_parameters={"idOrCode": FIXTURE_ID})
        self.assertIsNone(check(None, SimpleNamespace(status_code=404), ordinary))
        coverage = schema["/facilities"]["GET"].Case()
        coverage._meta = CaseMetadata(generation=GenerationInfo(time=0, mode=GenerationMode.POSITIVE), components={}, phase=PhaseInfo.coverage(CoverageScenario.DEFAULT_POSITIVE_TEST, "offline test"))
        self.assertIsNone(check(None, SimpleNamespace(status_code=422), coverage))
        # The oversize twin has its own 413 contract, not the 2xx one.
        oversize = next(case for case in ExamplesGenerator(operation=schema["/feedstocks"]["POST"], as_strategy_kwargs={}, feedback=FeedbackSources(), fill_missing=False) if case.meta.generation.mode.is_negative)
        self.assertIsNone(check(None, SimpleNamespace(status_code=413), oversize))

    def test_only_positive_cursors_are_omitted(self):
        operation = schema["/facilities"]["GET"]
        for mode in GenerationMode:
            case = operation.Case(query={"cursor": "opaque", "q": "wood"})
            case._meta = CaseMetadata(generation=GenerationInfo(time=0, mode=mode), components={}, phase=PhaseInfo.coverage(CoverageScenario.DEFAULT_POSITIVE_TEST, "offline test"))
            hook("before_call")(HookContext(operation=operation), case)
            self.assertEqual("cursor" in case.query, mode.is_negative)
            self.assertEqual(case.query["q"], "wood")

    def test_only_positive_creates_regain_a_dropped_idempotency_key(self):
        operation = schema["/lab-samples"]["POST"]
        for mode in GenerationMode:
            case = operation.Case(headers={}, body={})
            case._meta = CaseMetadata(generation=GenerationInfo(time=0, mode=mode), components={}, phase=PhaseInfo.coverage(CoverageScenario.DEFAULT_POSITIVE_TEST, "offline test"))
            hook("before_call")(HookContext(operation=operation), case)
            self.assertEqual("Idempotency-Key" in case.headers, mode.is_positive)
        kept = operation.Case(headers={"idempotency-key": "kept"}, body={})
        kept._meta = CaseMetadata(generation=GenerationInfo(time=0, mode=GenerationMode.POSITIVE), components={}, phase=PhaseInfo.coverage(CoverageScenario.DEFAULT_POSITIVE_TEST, "offline test"))
        hook("before_call")(HookContext(operation=operation), kept)
        self.assertEqual(kept.headers, {"idempotency-key": "kept"})
        patch = schema["/lab-samples/{idOrCode}"]["PATCH"].Case(headers={}, body={})
        patch._meta = kept._meta
        hook("before_call")(HookContext(operation=patch.operation), patch)
        self.assertNotIn("Idempotency-Key", patch.headers)

    def test_dropped_required_if_match_is_negative_in_stateful_calls(self):
        for result in schema.get_all_operations():
            operation = result.ok()
            if not any(parameter.name == "If-Match" and parameter.is_required for parameter in operation.headers):
                continue
            for mode in GenerationMode:
                for headers, tracked in (({}, True), (None, True), ({}, False), ({"if-match": FEEDSTOCK_ETAG}, True)):
                    if mode.is_negative and not tracked:
                        continue
                    with self.subTest(operation=operation.label, mode=mode, headers=headers, tracked=tracked):
                        metadata = CaseMetadata(
                            generation=GenerationInfo(time=0, mode=mode),
                            components={ParameterLocation.HEADER: ComponentInfo(mode=mode)} if tracked else {},
                            phase=PhaseInfo(name=TestPhase.STATEFUL, data=StatefulPhaseData(
                                description=None, parameter=None, parameter_location=None, location=None,
                            )),
                        )
                        case = operation.Case(path_parameters={"idOrCode": FIXTURE_ID}, headers=headers, body={}, _meta=metadata)
                        response = SimpleNamespace(status_code=428)
                        # Exercise Case.call's hook dispatch and metadata freezing without HTTP.
                        with patch.object(type(schema.transport), "send", return_value=response) as send:
                            self.assertIs(case.call(), response)
                        send.assert_called_once()
                        self.assertEqual(dict(case.headers), headers or {})
                        expected = mode if headers else GenerationMode.NEGATIVE
                        self.assertEqual(case.meta.generation.mode, expected)
                        self.assertEqual(case.meta.components[ParameterLocation.HEADER].mode, expected)
                        ctx = SimpleNamespace(config=schema.config.checks_config_for(operation=operation, phase="stateful"))
                        if not headers:
                            self.assertIsNone(positive_data_acceptance(ctx, response, case))
                            self.assertIsNone(negative_data_rejection(ctx, response, case))
                            with self.assertRaises(AssertionError):
                                negative_data_rejection(ctx, SimpleNamespace(status_code=200), case)
                        elif mode.is_positive:
                            with self.assertRaises(AssertionError):
                                positive_data_acceptance(ctx, response, case)

        read = schema["/feedstocks/{idOrCode}"]["GET"].Case(headers={})
        read._meta = CaseMetadata(generation=GenerationInfo(time=0, mode=GenerationMode.POSITIVE), components={}, phase=PhaseInfo.coverage(CoverageScenario.DEFAULT_POSITIVE_TEST, "offline test"))
        hook("before_call")(HookContext(operation=read.operation), read)
        self.assertTrue(read.meta.generation.mode.is_positive)

    def test_missing_if_match_coverage_still_requires_rejection(self):
        operation = schema["/feedstocks/{idOrCode}"]["PATCH"]
        cases = iter_coverage_cases(
            operation=operation, generation_modes=list(GenerationMode),
            generate_duplicate_query_parameters=False, unexpected_methods=set(),
            generation_config=schema.config.generation,
        )
        case = next(case for case in cases if case.meta.phase.data.parameter == "If-Match" and case.meta.phase.data.scenario == CoverageScenario.MISSING_PARAMETER)
        metadata = case.meta
        hook("before_call")(HookContext(operation=operation), case)
        self.assertIs(case.meta, metadata)
        self.assertTrue(case.meta.generation.mode.is_negative)
        self.assertNotIn("If-Match", case.headers)
        ctx = SimpleNamespace(config=schema.config.checks_config_for(operation=operation, phase="coverage"))
        self.assertIsNone(missing_required_header(ctx, SimpleNamespace(status_code=428), case))
        with self.assertRaises(AssertionError):
            missing_required_header(ctx, SimpleNamespace(status_code=200), case)

    def test_decimal_multiple_of_artifact_is_positive_after_call(self):
        operation = schema["/orders"]["POST"]
        for mode in GenerationMode:
            with self.subTest(mode=mode):
                case = self.order_quantity_case(FLOAT_MULTIPLE_OF_ARTIFACT, mode)
                original = dict(case.body)
                response = SimpleNamespace(status_code=201)
                with patch.object(type(schema.transport), "send", return_value=response):
                    self.assertIs(case.call(), response)
                self.assertEqual(case.body, original)
                ctx = SimpleNamespace(config=schema.config.checks_config_for(operation=operation, phase="coverage"))
                self.assertIsNone(negative_data_rejection(ctx, response, case))
                self.assertTrue(case.meta.components[ParameterLocation.BODY].mode.is_positive)
                self.assertTrue(case.meta.generation.mode.is_positive)
                with self.assertRaises(AssertionError):
                    positive_data_acceptance(ctx, SimpleNamespace(status_code=400), case)

    def test_decimal_artifact_does_not_hide_other_schema_violations(self):
        mutations = (
            lambda case: case.body.update(quantityKg=0.0005),
            lambda case: case.body.update(quantityKg=0.0015),
            lambda case: case.body.update(quantityKg=0.0010000000000000002),
            lambda case: case.body.update(quantityKg=-FLOAT_MULTIPLE_OF_ARTIFACT),
            lambda case: case.body.update(quantityKg=100000000.001),
            lambda case: case.body.pop("customerLocationId"),
            lambda case: case.body.update(customerLocationId="invalid"),
            lambda case: case.body.update(orderDate="invalid"),
            lambda case: case.body.update(packaging="invalid"),
            lambda case: case.body.update(unexpected=True),
            lambda case: case.headers.clear(),
            lambda case: case.query.update(dryRun="invalid"),
        )
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                case = self.order_quantity_case(FLOAT_MULTIPLE_OF_ARTIFACT, GenerationMode.NEGATIVE)
                mutate(case)
                # Model the metadata after generation/revalidation for every component.
                for location in (ParameterLocation.HEADER, ParameterLocation.QUERY):
                    valid = case._validate_component(location, case.get_container(location), case.operation.schema.adapter.jsonschema_validator_cls)
                    case._meta.components[location] = ComponentInfo(mode=GenerationMode.POSITIVE if valid else GenerationMode.NEGATIVE)
                case._init_hashes()
                response = SimpleNamespace(status_code=201, request=Request(
                    "POST", "http://localhost/orders", params=case.query, headers=case.headers, json=case.body,
                ).prepare())
                with patch.object(type(schema.transport), "send", return_value=response):
                    case.call()
                self.assertTrue(case.meta.generation.mode.is_negative)
                ctx = SimpleNamespace(config=schema.config.checks_config_for(operation=case.operation, phase="coverage"))
                self.assertIsNone(negative_data_rejection(ctx, SimpleNamespace(status_code=422), case))
                with self.assertRaises(AssertionError):
                    negative_data_rejection(ctx, response, case)

    def test_non_multiple_quantities_are_still_generated_as_negative(self):
        operation = schema["/orders"]["POST"]
        cases = iter_coverage_cases(
            operation=operation, generation_modes=list(GenerationMode),
            generate_duplicate_query_parameters=False, unexpected_methods=set(),
            generation_config=schema.config.generation,
        )
        case = next(case for case in cases if case.meta.phase.data.scenario == CoverageScenario.NOT_MULTIPLE_OF
                    and isinstance(case.body, dict) and "quantityKg" in case.body
                    and Decimal(str(case.body["quantityKg"])) % Decimal("0.001") != 0)
        quantity = case.body["quantityKg"]
        with patch.object(type(schema.transport), "send", return_value=SimpleNamespace(status_code=201)):
            case.call()
        self.assertEqual(case.body["quantityKg"], quantity)
        self.assertTrue(case.meta.generation.mode.is_negative)
        ctx = SimpleNamespace(config=schema.config.checks_config_for(operation=operation, phase="coverage"))
        with self.assertRaises(AssertionError):
            negative_data_rejection(ctx, SimpleNamespace(status_code=201), case)

    def order_quantity_case(self, quantity, mode):
        operation = schema["/orders"]["POST"]
        body = dict(operation.definition.raw["requestBody"]["content"]["application/json"]["example"], quantityKg=quantity)
        return operation.Case(
            body=body, media_type="application/json", query={"dryRun": "true"},
            headers={"Idempotency-Key": FIXTURE_ID},
            _meta=CaseMetadata(
                generation=GenerationInfo(time=0, mode=mode),
                components={ParameterLocation.BODY: ComponentInfo(mode=mode)},
                phase=PhaseInfo.coverage(CoverageScenario.DEFAULT_POSITIVE_TEST, "Positive test case"),
            ),
        )

    @settings(max_examples=5, database=None, deadline=None)
    @given(schema["/facilities"]["GET"].as_strategy(generation_mode=GenerationMode.POSITIVE))
    def test_generated_positive_queries_keep_valid_metadata(self, case):
        hook("before_call")(HookContext(operation=case.operation), case)
        self.assertNotIn("cursor", case.query)
        self.assertTrue(case.meta.generation.mode.is_positive)
        for field in ("q", "code"):
            for character in case.query.get(field, ""):
                self.assertFalse(ord(character) < 32 or 127 <= ord(character) <= 159)

    def test_transport_exception_delegates_every_other_status(self):
        check = hook("after_load_schema").__globals__["application_status_code_conformance"]
        delegate = Mock(return_value="checked")
        with patch.dict(check.__globals__, status_code_conformance=delegate):
            for status in (414, 431):
                self.assertIsNone(check(None, SimpleNamespace(status_code=status), None))
            delegate.assert_not_called()
            for status in (200, 400, 401, 428, 500):
                self.assertEqual(check(None, SimpleNamespace(status_code=status), None), "checked")
            self.assertEqual(delegate.call_count, 5)

    def test_428_scope_parser_method_exclusions_and_write_positive_statuses(self):
        for result in schema.get_all_operations():
            operation = result.ok()
            checks = schema.config.checks_config_for(operation=operation, phase="coverage")
            has_if_match = operation.method.upper() in {"PATCH", "DELETE"}
            self.assertEqual(has_if_match, any(parameter.name == "If-Match" for parameter in operation.headers))
            self.assertEqual("428" in checks.missing_required_header.expected_statuses, has_if_match)
            self.assertNotIn("400", checks.positive_data_acceptance.expected_statuses)
            self.assertIn("414", checks.positive_data_acceptance.expected_statuses)
            self.assertIn("431", checks.positive_data_acceptance.expected_statuses)
            self.assertIn("413", checks.negative_data_rejection.expected_statuses)
            coverage = schema.config.phases_for(operation=operation).coverage
            self.assertNotIn("trace", coverage.unexpected_methods)
            self.assertNotIn("query", coverage.unexpected_methods)
            self.assertEqual("422" in checks.positive_data_acceptance.expected_statuses, operation.method.upper() in {"POST", "PATCH", "DELETE"})
            self.assertEqual("413" in checks.positive_data_acceptance.expected_statuses, operation.method.upper() in {"POST", "PATCH", "DELETE"})

    def test_401_is_allowed_only_when_fixture_credential_is_absent(self):
        check = hook("after_load_schema").__globals__["configured_authentication"]
        operation = schema["/facilities/{idOrCode}"]["GET"]
        case = operation.Case(path_parameters={"idOrCode": FIXTURE_ID})
        for headers in ({}, {"Authorization": "Bearer invalid-placeholder"}):
            response = SimpleNamespace(status_code=401, request=SimpleNamespace(headers=headers))
            self.assertIsNone(check(None, response, case))
        response = SimpleNamespace(status_code=401, request=SimpleNamespace(headers=schema.config.headers))
        with self.assertRaisesRegex(AssertionError, "Configured bearer credential was rejected"):
            check(None, response, case)

    def test_negative_auth_probe_removes_configured_header(self):
        operation = schema["/facilities/{idOrCode}"]["GET"]
        cases = iter_coverage_cases(
            operation=operation, generation_modes=list(GenerationMode),
            generate_duplicate_query_parameters=False, unexpected_methods=set(),
            generation_config=schema.config.generation,
        )
        probes = [case for case in cases if case.meta.phase.data.parameter == "Authorization"]
        self.assertTrue(probes)
        for case in probes:
            self.assertTrue(case.meta.generation.mode.is_negative)
            serialized = case.as_transport_kwargs(headers=schema.config.headers)
            self.assertNotIn("Authorization", serialized["headers"])


if __name__ == "__main__":
    unittest.main()
