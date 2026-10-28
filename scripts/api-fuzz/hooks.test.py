"""Offline tests. Run with the same Schemathesis 4.29.3 Python environment."""

import json
import os
import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
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
DELETE_FORMULATION_ID = "66666666-6666-4666-8666-666666666666"
ARCHIVE_FORMULATION_ID = "77777777-7777-4777-8777-777777777777"
RESTORE_FORMULATION_ID = "88888888-8888-4888-8888-888888888888"
FORMULATION_ETAG = '\"1.2\"'
RESTORE_FORMULATION_ETAG = '\"2.2\"'
FORMULATION_FIXTURE = {
    "blendFeedstockTypeId": FIXTURE_ID,
    "blendFormulationId": FIXTURE_ID, "blendFormulationEtag": FORMULATION_ETAG,
    "deleteFormulationId": DELETE_FORMULATION_ID, "deleteFormulationEtag": FORMULATION_ETAG,
    "archiveFormulationId": ARCHIVE_FORMULATION_ID, "archiveFormulationEtag": FORMULATION_ETAG,
    "restoreFormulationId": RESTORE_FORMULATION_ID, "restoreFormulationEtag": RESTORE_FORMULATION_ETAG,
}
PARTY_FIXTURE = {"facilityId": FIXTURE_ID, "supplierId": FIXTURE_ID, "customerId": FIXTURE_ID,
                 "supplierEtag": '\"1.2\"', "customerEtag": '\"1.2\"'}
for index, party in enumerate(("Supplier", "Customer")):
    for offset, purpose in enumerate(("delete", "archive", "restore")):
        target = f"{index + 1}{offset + 1}111111-1111-4111-8111-111111111111"
        PARTY_FIXTURE[purpose + party + "Id"] = target
        PARTY_FIXTURE[purpose + party + "Etag"] = '\"2.2\"' if purpose == "restore" else '\"1.2\"'
for party in ("Supplier", "Customer"):
    for purpose in ("delete", "archive", "restore"):
        prefix = purpose + party + "Location"
        PARTY_FIXTURE[prefix + "Id"] = CUSTOMER_LOCATION_ID
        PARTY_FIXTURE[prefix + "Etag"] = '"3.1"'
        PARTY_FIXTURE[prefix + "ParentId"] = FIXTURE_ID
    PARTY_FIXTURE[party.lower() + "LocationId"] = CUSTOMER_LOCATION_ID
    PARTY_FIXTURE[party.lower() + "LocationEtag"] = '"1.1"'
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
document_fixture_directory = TemporaryDirectory()
document_fixtures = [
    {"ownerType": owner, "ownerId": FIXTURE_ID,
     "documentType": "photo" if owner == "application" else "lab_report" if owner == "lab_sample" else "bill_of_lading",
     "uploaded": {"id": PRODUCT_BIN_ID, "etag": '"2.1"', "physicalObject": True},
     "pending": {"id": DELETE_ORDER_ID, "etag": '"1.1"', "data": {"id": DELETE_ORDER_ID, "uploadStatus": "pending", "version": 1}}}
    for owner in ("delivery", "feedstock", "lab_sample", "application")
]
document_fixture_path = Path(document_fixture_directory.name) / "fixture.json"
document_fixture_path.write_text(json.dumps({**FORMULATION_FIXTURE, **PARTY_FIXTURE, "documents": document_fixtures, "applicationId": FIXTURE_ID, "applicationCode": "AP-FUZZ",
    "applicationEtag": '"1.1"', "applicationDeliveryId": RUN_BIN_ID, "applicationDeliveryCode": "DL-FUZZ-APP",
    "applicationDate": "2026-10-09", "applicationGpsLatitude": -8.3, "applicationGpsLongitude": 35.3}))
os.environ["API_FUZZ_FIXTURE"] = str(document_fixture_path)
config = SchemathesisConfig.from_path("schemathesis.toml")
with patch("datetime.datetime", wraps=datetime) as fixture_clock:
    fixture_clock.now.return_value = FIXTURE_NOW
    schema = schemathesis.openapi.from_path("openapi/v1.json", config=config)


def hook(name):
    return GLOBAL_HOOK_DISPATCHER.get_all_by_name(name)[0]


class HarnessTests(unittest.TestCase):
    def document_examples(self, owner="deliveries", suffix="", method="GET"):
        operation = schema[f"/{owner}/{{idOrCode}}/documents{suffix}"][method]
        cases = ExamplesGenerator(operation=operation, as_strategy_kwargs={}, feedback=FeedbackSources(), fill_missing=False)
        return [case for case in cases if case.meta.phase.data.description.startswith("Document fixture")]

    def test_documents_have_seeded_reads_uploads_and_distinct_confirms(self):
        for owner in ("deliveries", "feedstocks", "lab-samples", "applications"):
            for suffix in ("", "/{documentId}", "/{documentId}/content"):
                case, = self.document_examples(owner, suffix)
                self.assertEqual(case.path_parameters["idOrCode"], FIXTURE_ID)
                self.assertFalse(for_operation(schema.config, operation=case.operation).path_parameters)
            create, = self.document_examples(owner, method="POST")
            again, = self.document_examples(owner, method="POST")
            self.assertNotEqual(create.headers["Idempotency-Key"], again.headers["Idempotency-Key"])
            self.assertRegex(create.body["sha256"], r"^[a-f0-9]{64}$")
            self.assertEqual(create.body["sizeBytes"], 8)
            self.assertFalse(create.query)
            positive, negative = self.document_examples(owner, "/{documentId}/confirm", "POST")
            self.assertEqual(positive.path_parameters["documentId"], PRODUCT_BIN_ID)
            self.assertEqual(negative.path_parameters["documentId"], DELETE_ORDER_ID)
            self.assertTrue(positive.meta.generation.mode.is_positive)
            self.assertFalse(negative.meta.generation.mode.is_positive)
            self.assertFalse(positive.headers)
            self.assertEqual(positive.body, {})
            check = hook("after_load_schema").__globals__["seeded_example_success"]
            check(None, SimpleNamespace(status_code=200), positive)
            with self.assertRaises(AssertionError):
                check(None, SimpleNamespace(status_code=409), positive)
            check(None, SimpleNamespace(status_code=409), negative)

    def test_applications_have_seeded_reads_and_a_small_create_without_mutating_examples(self):
        expected = {
            "GET /applications": None,
            "GET /applications/{idOrCode}": FIXTURE_ID,
            "GET /applications/{idOrCode}/boundary": FIXTURE_ID,
            "GET /deliveries/{idOrCode}/application-balance": RUN_BIN_ID,
            "POST /applications": None,
        }
        for label, target in expected.items():
            method, path = label.split(" ", 1)
            operation = schema[path][method]
            examples = []
            hook("before_add_examples")(HookContext(operation=operation), examples)
            case, = examples
            self.assertTrue(case.meta.generation.mode.is_positive)
            if target:
                self.assertEqual(case.path_parameters, {"idOrCode": target})
            if method == "POST":
                again = []
                hook("before_add_examples")(HookContext(operation=operation), again)
                self.assertNotEqual(case.headers["Idempotency-Key"], again[0].headers["Idempotency-Key"])
                self.assertEqual(case.query, {"dryRun": "true"})
                self.assertEqual(case.body, {"deliveryId": RUN_BIN_ID, "appliedWetMassKg": 0.001,
                    "applicationDate": "2026-10-09", "fieldSizeHa": 1, "evidenceMethod": "location",
                    "gpsLatitude": -8.3, "gpsLongitude": 35.3})
            check = hook("after_load_schema").__globals__["seeded_example_success"]
            check(None, SimpleNamespace(status_code=200), case)
            with self.assertRaises(AssertionError):
                check(None, SimpleNamespace(status_code=404), case)
        for method in ("PATCH", "DELETE"):
            operation = schema["/applications/{idOrCode}"][method]
            examples = []
            hook("before_add_examples")(HookContext(operation=operation), examples)
            self.assertEqual(examples, [])
            for phase in ("fuzzing", "coverage", "stateful"):
                checks = schema.config.checks_config_for(operation=operation, phase=phase)
                self.assertIn("412", checks.positive_data_acceptance.expected_statuses)
                self.assertIn("412", checks.negative_data_rejection.expected_statuses)
                self.assertIn("428", checks.missing_required_header.expected_statuses)

    def party_examples(self, path, method):
        operation = schema[path][method]
        examples = []
        hook("before_add_examples")(HookContext(operation=operation), examples)
        return examples

    def test_party_commands_use_distinct_targets_in_the_required_start_state(self):
        check = hook("after_load_schema").__globals__["seeded_example_success"]
        for plural, party in (("suppliers", "Supplier"), ("customers", "Customer")):
            for command, expected_version in (("archive", 1), ("restore", 2)):
                case, = self.party_examples(f"/{plural}/{{idOrCode}}/{command}", "POST")
                parameter, = case.operation.path_parameters
                self.assertEqual(case.path_parameters, {parameter.name: PARTY_FIXTURE[command + party + "Id"]})
                self.assertNotEqual(case.path_parameters[parameter.name], PARTY_FIXTURE["delete" + party + "Id"])
                self.assertEqual(case.headers["If-Match"], f'"{expected_version}.2"')
                self.assertEqual(case.body, {})
                self.assertEqual(case.query, {"dryRun": "true"})
                self.assertTrue(case.meta.generation.mode.is_positive)
                states = {
                    PARTY_FIXTURE["archive" + party + "Id"]: {"version": 1, "archived": False},
                    PARTY_FIXTURE["restore" + party + "Id"]: {"version": 2, "archived": True},
                }
                state = states[case.path_parameters[parameter.name]]
                version = int(case.headers["If-Match"].strip('"').split(".")[0])
                status = 200 if state["version"] == version and state["archived"] == (command == "restore") else 409
                check(None, SimpleNamespace(status_code=status), case)
                for status in (404, 409, 412, 422):
                    with self.assertRaises(AssertionError):
                        check(None, SimpleNamespace(status_code=status), case)
            patch_case, = self.party_examples(f"/{plural}/{{idOrCode}}", "PATCH")
            delete_case, = self.party_examples(f"/{plural}/{{idOrCode}}", "DELETE")
            self.assertEqual(patch_case.headers["If-Match"], PARTY_FIXTURE[party.lower() + "Etag"])
            self.assertEqual(delete_case.path_parameters, {"idOrCode": PARTY_FIXTURE["delete" + party + "Id"]})

    def test_party_create_examples_exercise_distance_and_location_count_boundaries(self):
        for plural in ("suppliers", "customers"):
            cases = self.party_examples(f"/{plural}", "POST")
            self.assertEqual(len(cases), 6)
            self.assertEqual([case.body["locations"][0]["facilityDistances"][0]["distanceKm"] for case in cases[:3]], [0.001, 20000, 20000.001])
            self.assertEqual([len(case.body["locations"]) for case in cases[4:]], [50, 51])
            self.assertEqual(cases[3].body["locations"][0]["facilityDistances"][0]["distanceKm"], 5e-324)
            for case, valid in zip(cases, (True, True, False, False, True, False)):
                self.assertEqual(case._validate_component(ParameterLocation.BODY, case.body, schema.adapter.jsonschema_validator_cls), valid)
                self.assertEqual(case.meta.generation.mode.is_positive, valid)
                self.assertEqual(case.query, {"dryRun": "true"})
                self.assertTrue(case.headers["Idempotency-Key"])
                check = hook("after_load_schema").__globals__["seeded_example_success" if valid else "seeded_party_boundary_rejection"]
                problem = {"code": "validation_failed", "errors": [{"pointer": "/locations/0/facilityDistances/0/distanceKm"}]}
                check(None, SimpleNamespace(status_code=201 if valid else 422, json=lambda: problem), case)
                with self.assertRaises(AssertionError):
                    check(None, SimpleNamespace(status_code=409 if valid else 201), case)

    def test_party_boundary_refusals_identify_locations_validation(self):
        check = hook("after_load_schema").__globals__["seeded_party_boundary_rejection"]
        for plural in ("suppliers", "customers"):
            for case in self.party_examples(f"/{plural}", "POST"):
                if case.meta.generation.mode.is_positive:
                    continue
                for pointer in ("/locations", "/locations/50", "/locations/0/facilityDistances/0/distanceKm"):
                    problem = {"code": "validation_failed", "errors": [{"pointer": pointer}]}
                    check(None, SimpleNamespace(status_code=422, json=lambda: problem), case)
                for problem in (
                    {"code": "conflict", "errors": [{"pointer": "/locations"}]},
                    {"code": "validation_failed", "errors": []},
                    {"code": "validation_failed", "errors": [{"pointer": "/name"}]},
                    {"code": "validation_failed", "errors": [{"pointer": "/locationsElsewhere"}]},
                ):
                    with self.assertRaises(AssertionError):
                        check(None, SimpleNamespace(status_code=422, json=lambda: problem), case)

    def test_formulation_commands_are_distinct_successful_transitions(self):
        for command, target, etag, archived in (
            ("archive", ARCHIVE_FORMULATION_ID, FORMULATION_ETAG, False),
            ("restore", RESTORE_FORMULATION_ID, RESTORE_FORMULATION_ETAG, True),
        ):
            operation = schema[f"/formulations/{{idOrCode}}/{command}"]["POST"]
            examples = []
            hook("before_add_examples")(HookContext(operation=operation), examples)
            case, = examples
            parameter, = operation.path_parameters
            self.assertEqual(case.path_parameters, {parameter.name: target})
            self.assertNotEqual(target, DELETE_FORMULATION_ID)
            self.assertEqual(case.headers["If-Match"], etag)
            self.assertEqual(case.query, {"dryRun": "true"})
            self.assertEqual(case.body, {})
            self.assertTrue(case.meta.generation.mode.is_positive)
            # Model the two published state guards and version precondition.
            # The supervisor runs these same examples against the real writers.
            state = {"id": target, "version": 2 if archived else 1, "archived": archived}
            version = int(case.headers["If-Match"].strip('"').split(".")[0])
            status = 200 if state["version"] == version and state["archived"] == (command == "restore") else 409
            check = hook("after_load_schema").__globals__["seeded_example_success"]
            check(None, SimpleNamespace(status_code=status), case)
            for refused in (404, 409, 412, 422):
                with self.assertRaises(AssertionError):
                    check(None, SimpleNamespace(status_code=refused), case)

    def test_formulation_examples_cover_exact_millionths_and_refuse_smaller_shares(self):
        operation = schema["/formulations"]["POST"]
        examples = []
        hook("before_add_examples")(HookContext(operation=operation), examples)
        self.assertEqual(len(examples), 3)
        positive = [case for case in examples if case.meta.generation.mode.is_positive]
        self.assertEqual([case.body["biocharRatio"] for case in positive], [0.7, 0.000001])
        for case in examples:
            self.assertEqual(case.query, {"dryRun": "true"})
            self.assertTrue(case.headers["Idempotency-Key"])
            self.assertEqual(case.body["lines"][0]["feedstockTypeId"], FIXTURE_ID)
        for case in positive:
            self.assertTrue(case._validate_component(ParameterLocation.BODY, case.body, schema.adapter.jsonschema_validator_cls))
            self.assertEqual(Decimal(str(case.body["biocharRatio"])) + Decimal(str(case.body["lines"][0]["ratio"])), Decimal("1"))
        negative, = [case for case in examples if case.meta.generation.mode.is_negative]
        self.assertEqual(negative.body["biocharRatio"], 0.0000001)
        self.assertFalse(negative._validate_component(ParameterLocation.BODY, negative.body, schema.adapter.jsonschema_validator_cls))
        hook("before_call")(HookContext(operation=operation), negative)
        self.assertTrue(negative.meta.generation.mode.is_negative)
        check = hook("after_load_schema").__globals__["seeded_formulation_ratio_rejection"]
        response = SimpleNamespace(status_code=422, json=lambda: {"code": "validation_failed", "errors": [{"pointer": "/biocharRatio"}]})
        check(None, response, negative)
        with self.assertRaises(AssertionError):
            check(None, SimpleNamespace(status_code=201), negative)
        wrong_pointer = SimpleNamespace(status_code=422, json=lambda: {"code": "validation_failed", "errors": [{"pointer": "/lines"}]})
        with self.assertRaises(AssertionError):
            check(None, wrong_pointer, negative)
        patch_examples = []
        hook("before_add_examples")(HookContext(operation=schema["/formulations/{idOrCode}"]["PATCH"]), patch_examples)
        patch_case, = patch_examples
        self.assertEqual(patch_case.headers["If-Match"], FORMULATION_ETAG)
        self.assertEqual(patch_case.body, {"biocharRatio": 0.000001, "lines": [{"feedstockTypeId": FIXTURE_ID, "ratio": 0.999999}]})

    def test_content_does_not_follow_capabilities_or_require_2xx(self):
        case, = self.document_examples(suffix="/{documentId}/content")
        kwargs = {}
        hook("before_call")(HookContext(operation=case.operation), case, kwargs)
        self.assertFalse(kwargs["allow_redirects"])
        check = hook("after_load_schema").__globals__["seeded_document_content_redirect"]
        check(None, SimpleNamespace(status_code=302, headers={"location": ["http://localhost/object"], "cache-control": ["private, no-store"]}), case)
        with self.assertRaises(AssertionError):
            check(None, SimpleNamespace(status_code=404, headers={}), case)
        fixtures = hook("after_load_schema").__globals__["DOCUMENT_FIXTURES"]
        with patch.dict(fixtures[0]["uploaded"], {"physicalObject": False}):
            self.assertEqual(self.document_examples(suffix="/{documentId}/content"), [])

    def test_pending_confirm_requires_retryable_conflict_and_unchanged_read(self):
        _, case = self.document_examples(suffix="/{documentId}/confirm", method="POST")
        globals_ = hook("after_load_schema").__globals__
        check = globals_["seeded_pending_document_unchanged"]
        response = SimpleNamespace(status_code=409, json=lambda: {"code": "conflict", "retryable": True})
        current = Mock(status_code=200, headers={"ETag": '"1.1"'})
        current.json.return_value = {"data": document_fixtures[0]["pending"]["data"]}
        with patch.object(globals_["requests"], "get", return_value=current) as get:
            check(None, response, case)
            self.assertFalse(get.call_args.kwargs["allow_redirects"])
            current.headers = {"ETag": '"2.1"'}
            with self.assertRaisesRegex(AssertionError, "changed"):
                check(None, response, case)
        with self.assertRaisesRegex(AssertionError, "retryable 409"):
            check(None, SimpleNamespace(status_code=200), case)

    def test_actual_examples_driver_reaches_all_seeded_targets_and_create(self):
        seeded = []
        for result in schema.get_all_operations():
            operation = result.ok()
            cases = ExamplesGenerator(operation=operation, as_strategy_kwargs={}, feedback=FeedbackSources(), fill_missing=False)
            seeded.extend(case for case in cases if case.meta.phase.data.description.startswith("Seeded fixture"))
        # Earlier phases contribute 44 cases. Formulations add two successful
        # creates and four mutations. Parties add six creates and eight mutations;
        # ratio and party boundary refusals are counted separately.
        # Locations add four boundary creates, six mutations and two detail reads.
        self.assertEqual(len(seeded), 76)
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
            if "{idOrCode}" not in operation.path or "/documents" in operation.path:
                continue
            examples = []
            hook("before_add_examples")(HookContext(operation=operation), examples)
            if operation.path == "/applications/{idOrCode}" and operation.method.upper() in {"PATCH", "DELETE"}:
                self.assertEqual(examples, [])
                continue
            if "/locations/{locationId}" in operation.path or (operation.path.endswith("/locations") and operation.method.upper() == "POST"):
                # Location cases have two path ids and their own assertions below.
                self.assertTrue(examples)
                self.assertFalse(for_operation(schema.config, operation=operation).path_parameters)
                self.assertFalse("If-Match" in for_operation(schema.config, operation=operation).headers)
                continue
            self.assertEqual(len(examples), 1, operation.label)
            target = RUN_BIN_ID if operation.path.endswith("/application-balance") else DELETE_ORDER_ID if operation.label == "DELETE /orders/{idOrCode}" else FIXTURE_ID
            if operation.label == "DELETE /formulations/{idOrCode}":
                target = DELETE_FORMULATION_ID
            elif operation.path.endswith("/archive"):
                target = ARCHIVE_FORMULATION_ID
            elif operation.path.endswith("/restore"):
                target = RESTORE_FORMULATION_ID
            for plural, party in (("suppliers", "Supplier"), ("customers", "Customer")):
                if operation.path.startswith(f"/{plural}/"):
                    if operation.method.upper() == "DELETE":
                        target = PARTY_FIXTURE["delete" + party + "Id"]
                    elif operation.path.endswith("/archive"):
                        target = PARTY_FIXTURE["archive" + party + "Id"]
                    elif operation.path.endswith("/restore"):
                        target = PARTY_FIXTURE["restore" + party + "Id"]
            self.assertEqual(examples[0].path_parameters, {"idOrCode": target})
            if operation.method.upper() == "POST" and not operation.path.endswith(("/archive", "/restore")):
                # The stock-movement create: a dry run with its own key.
                self.assertEqual(examples[0].query, {"dryRun": "true"})
                self.assertTrue(examples[0].headers["Idempotency-Key"])
            self.assertTrue(examples[0].meta.generation.mode.is_positive)
            self.assertEqual(examples[0].meta.phase.name.value, "examples")
            self.assertFalse(for_operation(schema.config, operation=operation).path_parameters)
            self.assertFalse("If-Match" in for_operation(schema.config, operation=operation).headers)
            if operation.method.upper() in {"PATCH", "DELETE"}:
                self.assertEqual(examples[0].query, {"dryRun": "true"})
                etags = {"/deliveries/": DELIVERY_ETAG, "/production-runs/": RUN_ETAG, "/biochar-products/": PRODUCT_ETAG, "/lab-samples/": LAB_SAMPLE_ETAG, "/formulations/": FORMULATION_ETAG, "/suppliers/": PARTY_FIXTURE["supplierEtag"], "/customers/": PARTY_FIXTURE["customerEtag"], "/orders/": DELETE_ORDER_ETAG if operation.method.upper() == "DELETE" else ORDER_ETAG}
                etag = etags.get(next((prefix for prefix in etags if operation.path.startswith(prefix)), ""), FEEDSTOCK_ETAG)
                self.assertEqual(examples[0].headers["If-Match"], etag)
            count += 1
        self.assertEqual(count, 47)

    def test_seeded_positive_examples_must_return_2xx(self):
        check = hook("after_load_schema").__globals__["seeded_example_success"]
        for result in schema.get_all_operations():
            operation = result.ok()
            examples = []
            hook("before_add_examples")(HookContext(operation=operation), examples)
            for case in examples:
                if not case.meta.generation.mode.is_positive or case.meta.phase.data.description == "Document fixture content redirect":
                    continue
                with self.subTest(operation=operation.label):
                    for status in (200, 201, 204):
                        self.assertIsNone(check(None, SimpleNamespace(status_code=status), case))
                    for status in (301, 400, 401, 404, 409, 412, 422, 428, 500):
                        with self.assertRaisesRegex(AssertionError, "must return 2xx"):
                            check(None, SimpleNamespace(status_code=status), case)
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

    def test_decimal_artifact_ignores_non_json_bodies(self):
        missing_body = schema["/orders"]["POST"].Case().body
        bodies = (b"raw body", missing_body, {"nested": [b"raw body"]}, {"nested": (1,)}, {1: "value"})
        for body in bodies:
            with self.subTest(body=body):
                case = self.order_quantity_case(FLOAT_MULTIPLE_OF_ARTIFACT, GenerationMode.NEGATIVE)
                case = case.operation.Case(body=body, media_type="application/json", _meta=case._meta)
                helper = hook("before_call").__globals__["body_has_decimal_multiple_of_artifact"]
                self.assertFalse(helper(case))
                hook("before_call")(HookContext(operation=case.operation), case)
                self.assertIs(case.body, body)
                self.assertTrue(case.meta.components[ParameterLocation.BODY].mode.is_negative)
                self.assertTrue(case.meta.generation.mode.is_negative)

    def test_decimal_artifact_ignores_non_json_media_type(self):
        case = self.order_quantity_case(FLOAT_MULTIPLE_OF_ARTIFACT, GenerationMode.NEGATIVE)
        case.media_type = "text/plain"
        body = dict(case.body)
        helper = hook("before_call").__globals__["body_has_decimal_multiple_of_artifact"]
        with patch.object(case.operation.body[0], "media_type", case.media_type):
            self.assertFalse(helper(case))
            hook("before_call")(HookContext(operation=case.operation), case)
        self.assertEqual(case.body, body)
        self.assertTrue(case.meta.components[ParameterLocation.BODY].mode.is_negative)
        self.assertTrue(case.meta.generation.mode.is_negative)

    def test_decimal_artifact_ignores_validator_exceptions(self):
        case = self.order_quantity_case(FLOAT_MULTIPLE_OF_ARTIFACT, GenerationMode.NEGATIVE)
        helper = hook("before_call").__globals__["body_has_decimal_multiple_of_artifact"]
        for error in (ValueError("unsupported value"), RuntimeError("validator failed")):
            with self.subTest(error=error):
                validator = Mock()
                validator.is_valid.side_effect = error
                with patch.object(schema.adapter, "jsonschema_validator_cls", return_value=validator):
                    self.assertFalse(helper(case))
                    hook("before_call")(HookContext(operation=case.operation), case)
                self.assertTrue(case.meta.components[ParameterLocation.BODY].mode.is_negative)
                self.assertTrue(case.meta.generation.mode.is_negative)

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

    def test_location_examples_use_both_ids_location_tags_and_dry_runs(self):
        for party in ("supplier", "customer"):
            base = f"/{party}s/{{idOrCode}}/locations"
            operations = [(base, "POST"), (base + "/{locationId}", "PATCH"), (base + "/{locationId}", "DELETE")]
            if party == "customer":
                operations += [(base + "/{locationId}/" + command, "POST") for command in ("archive", "restore")]
            for path, method in operations:
                operation = schema[path][method]
                examples = []
                hook("before_add_examples")(HookContext(operation=operation), examples)
                self.assertTrue(examples, operation.label)
                keys = []
                for case in examples:
                    self.assertEqual(case.query, {"dryRun": "true"})
                    self.assertEqual(case.path_parameters["idOrCode"], FIXTURE_ID)
                    self.assertEqual(set(case.path_parameters), {p.name for p in operation.path_parameters})
                    if path == base:
                        keys.append(case.headers["Idempotency-Key"])
                    else:
                        self.assertEqual(case.path_parameters["locationId"], CUSTOMER_LOCATION_ID)
                        self.assertEqual(case.headers["If-Match"], '"1.1"' if method == "PATCH" else '"3.1"')
                    check = hook("after_load_schema").__globals__["seeded_example_success"]
                    for status in (404, 409):
                        with self.assertRaises(AssertionError):
                            check(None, SimpleNamespace(status_code=status), case)
                    check(None, SimpleNamespace(status_code=200), case)
                if path == base:
                    self.assertEqual(len(keys), len(set(keys)))
                    self.assertEqual([case.body["facilityDistances"][0]["distanceKm"] for case in examples], [0.001, 20000])

    def test_428_scope_parser_method_exclusions_and_write_positive_statuses(self):
        for result in schema.get_all_operations():
            operation = result.ok()
            checks = schema.config.checks_config_for(operation=operation, phase="coverage")
            has_if_match = operation.method.upper() in {"PATCH", "DELETE"} or operation.path.endswith(("/archive", "/restore"))
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
