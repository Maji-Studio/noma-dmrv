"""Offline tests. Run with the same Schemathesis 4.29.3 Python environment."""

import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

import schemathesis
from hypothesis import given, settings
from schemathesis.config import SchemathesisConfig
from schemathesis.generation import GenerationMode
from schemathesis.generation.drivers import ExamplesGenerator
from schemathesis.generation.feedback import FeedbackSources
from schemathesis.generation.meta import CaseMetadata, GenerationInfo, PhaseInfo, CoverageScenario
from schemathesis.generation.overrides import for_operation
from schemathesis.hooks import GLOBAL_HOOK_DISPATCHER, HookContext
from schemathesis.specs.openapi.coverage._operation import iter_coverage_cases

FIXTURE_ID = "11111111-1111-4111-8111-111111111111"
FIXTURE_NOW = datetime(2026, 10, 9, tzinfo=timezone.utc)
RUN_BIN_ID = "22222222-2222-4222-8222-222222222222"
FEEDSTOCK_ETAG = '"2.3"'
RUN_ETAG = '"4.5"'
TARGET_KINDS = ("FACILITY", "SUPPLIER", "FEEDSTOCK_TYPE", "BIN", "DRIVER", "VEHICLE", "FEEDSTOCK", "REACTOR", "PRODUCTION_RUN")
for kind in TARGET_KINDS:
    os.environ[f"API_FUZZ_{kind}_ID"] = FIXTURE_ID
os.environ.update(
    API_FUZZ_BASE_URL="http://localhost/api/v1", API_FUZZ_KEY="offline-placeholder",
    API_FUZZ_FEEDSTOCK_ETAG=FEEDSTOCK_ETAG, API_FUZZ_PRODUCTION_RUN_ETAG=RUN_ETAG, API_FUZZ_RUN_BIN_ID=RUN_BIN_ID,
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
        # 14 by-id targets, the feedstock create and its oversize twin, the run create.
        self.assertEqual(len(seeded), 17)
        create = next(case for case in seeded if case.operation.label == "POST /feedstocks" and case.meta.generation.mode.is_positive)
        self.assertEqual(create.query, {"dryRun": "true"})
        self.assertTrue(create.headers["Idempotency-Key"])
        self.assertTrue(create.meta.generation.mode.is_positive)
        for field in ("facilityId", "supplierId", "feedstockTypeId"):
            self.assertEqual(create.body[field], FIXTURE_ID)
        self.assertEqual(create.body["allocations"][0]["storageLocationId"], FIXTURE_ID)
        self.assertEqual(create.body["deliveryDate"], FIXTURE_NOW.date().isoformat())
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
            self.assertEqual(examples[0].path_parameters, {"idOrCode": FIXTURE_ID})
            self.assertTrue(examples[0].meta.generation.mode.is_positive)
            self.assertEqual(examples[0].meta.phase.name.value, "examples")
            self.assertFalse(for_operation(schema.config, operation=operation).path_parameters)
            self.assertFalse("If-Match" in for_operation(schema.config, operation=operation).headers)
            if operation.method.upper() in {"PATCH", "DELETE"}:
                self.assertEqual(examples[0].query, {"dryRun": "true"})
                etag = RUN_ETAG if operation.path.startswith("/production-runs/") else FEEDSTOCK_ETAG
                self.assertEqual(examples[0].headers["If-Match"], etag)
            count += 1
        self.assertEqual(count, 14)

    def test_seeded_positive_examples_must_return_2xx(self):
        check = hook("after_load_schema").__globals__["seeded_example_success"]
        for label in ("GET /feedstocks/{idOrCode}", "GET /production-runs/{idOrCode}", "PATCH /production-runs/{idOrCode}"):
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
        for label in ("POST /feedstocks", "POST /production-runs"):
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
