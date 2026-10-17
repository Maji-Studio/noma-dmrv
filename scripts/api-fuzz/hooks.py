"""Schemathesis 4.29.3 adaptations for opaque inputs and local HTTP transport."""

import os
import json
import requests
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal, DecimalException
from uuid import uuid4

import schemathesis
from schemathesis.core.jsonschema import FANCY_REGEX_OPTIONS
from schemathesis.core.media_types import is_json
from schemathesis.core.parameters import ParameterLocation
from schemathesis.generation import GenerationMode
from schemathesis.generation.meta import CaseMetadata, ComponentInfo, ExamplesPhaseData, GenerationInfo, PhaseInfo, TestPhase
from schemathesis.specs.openapi.checks import status_code_conformance

TRANSPORT_REJECTIONS = frozenset({414, 431})
# Mirrored from src/config/api-rest.ts for the Python-only harness.
API_BODY_MAX_BYTES = 256 * 1024
OVERSIZE_EXAMPLE_DESCRIPTION = "Seeded fixture oversize create"
SEEDED_TARGET_DESCRIPTION = "Seeded fixture target"
SEEDED_CREATE_DESCRIPTION = "Seeded fixture create"
# Positive seeded examples: any other status means the fixture or contract broke.
SEEDED_SUCCESS_DESCRIPTIONS = frozenset({SEEDED_TARGET_DESCRIPTION, SEEDED_CREATE_DESCRIPTION})
# seed.ts closes its run 2 to 3 hours ago; the create example starts later on
# the same reactor so the overlap guard accepts it.
SEEDED_RUN_CREATE_START_AGE = timedelta(hours=1)
# Wet kg drawn by the seeded run create from the run bin (seed.ts draws the same).
SEEDED_RUN_DRAW_WET_MASS_KG = 10
SEEDED_RUN_MOISTURE_PERCENT = 20
# seed.ts places its product 4 hours ago and posts a loss 3.5 hours ago, both
# after the completed run's output. The dry-run examples sit after them all.
SEEDED_PRODUCT_PLACED_AGE = timedelta(minutes=30)
SEEDED_MOVEMENT_AGE = timedelta(hours=1)
# Wet kg of biochar the seeded product create draws (seed.ts draws the same).
SEEDED_PRODUCT_BIOCHAR_WET_MASS_KG = 5
SEEDED_BIOCHAR_MOISTURE_PERCENT = 10
# Well under what the seeded biochar bin holds after its product and loss.
SEEDED_LOSS_WET_MASS_KG = 1
# seed.ts takes its lab sample 1 hour ago, inside the credit batch window. The
# dry-run create is taken later still, and never in the future.
SEEDED_LAB_SAMPLE_AGE = timedelta(minutes=30)
# A real change on a 200-year batch, so the dry run PATCH has something to apply.
SEEDED_LAB_SAMPLE_PATCH = {"labName": "API fuzz lab"}
# Seeded orders are loose; changing packaging keeps the large delivery balance intact.
SEEDED_ORDER_PATCH = {"packaging": "bagged"}
# After the seeded delivery (1 hour ago), well within its remaining stock.
SEEDED_DELIVERY_AGE = timedelta(minutes=30)
SEEDED_DELIVERY_WET_MASS_KG = 0.1
SEEDED_DELIVERY_PATCH = {"distanceNote": "API fuzz delivery note"}
IDEMPOTENCY_HEADER = "Idempotency-Key"
IF_MATCH_HEADER = "If-Match"
DOCUMENT_CONTENT_DESCRIPTION = "Document fixture content redirect"
DOCUMENT_PENDING_DESCRIPTION = "Document fixture pending confirm refusal"
DOCUMENT_SUCCESS_DESCRIPTION = "Document fixture success"
DOCUMENT_TIMEOUT_SECONDS = 10
DOCUMENT_FIXTURES = []
APPLICATION_FIXTURE = {}
FORMULATION_FIXTURE = {}
PARTY_FIXTURE = {}
# Mirrored from src/config/party-input.ts for the Python-only harness.
LOCATION_DISTANCE_MIN_KM = 0.001
LOCATION_DISTANCE_MAX_KM = 20_000
LOCATION_DISTANCE_SUBNORMAL_KM = 5e-324
PARTY_MAX_LOCATIONS = 50
PARTY_BOUNDARY_REFUSAL_DESCRIPTION = "Party fixture boundary refusal"
FORMULATION_RATIO_REFUSAL_DESCRIPTION = "Formulation fixture sub-millionth refusal"
FORMULATION_MIN_RATIO = 0.000001
FORMULATION_TOO_SMALL_RATIO = 0.0000001
FORMULATION_COMPLEMENT_RATIO = 0.999999
FORMULATION_BIOCHAR_RATIO = 0.7
FORMULATION_COMPOST_RATIO = 0.3
SEEDED_APPLICATION_WET_MASS_KG = 0.001
SEEDED_APPLICATION_FIELD_SIZE_HA = 1
DOCUMENT_PATHS = {"delivery": "deliveries", "feedstock": "feedstocks", "lab_sample": "lab-samples", "application": "applications"}
SEEDED_TARGETS = {}
SEEDED_ETAGS = {}
SEEDED_CREATE_BODIES = {}
SEEDED_PATCH_BODIES = {}


@schemathesis.check
def application_status_code_conformance(ctx, response, case):
    # Node/Vercel can reject an oversized URI/header block before app code runs.
    # These responses have no application contract. All other statuses are checked.
    if response.status_code in TRANSPORT_REJECTIONS:
        return None
    return status_code_conformance(ctx, response, case)


@schemathesis.check
def seeded_oversize_rejection(ctx, response, case):
    if case.meta is not None and case.meta.phase.name == TestPhase.EXAMPLES and case.meta.phase.data.description == OVERSIZE_EXAMPLE_DESCRIPTION:
        if response.status_code != 413:
            raise AssertionError(f"Seeded oversize create must return 413, received {response.status_code}.")


@schemathesis.check
def seeded_example_success(ctx, response, case):
    # The status allowances for positive data (404, 409, 422, ...) exist for
    # generated cases. A fixture-backed example is built to succeed.
    if case.meta is not None and case.meta.phase.name == TestPhase.EXAMPLES and case.meta.phase.data.description in SEEDED_SUCCESS_DESCRIPTIONS | {DOCUMENT_SUCCESS_DESCRIPTION}:
        if not 200 <= response.status_code < 300:
            raise AssertionError(f"Seeded positive example for {case.operation.label} must return 2xx, received {response.status_code}.")


@schemathesis.check
def configured_authentication(ctx, response, case):
    # Negative auth probes deliberately remove/replace the bearer header. Keep
    # those 401s, but never let the general positive-status allowance hide a
    # rejection of the configured fixture credential. No key is in the message.
    expected = case.operation.schema.config.headers_for(operation=case.operation).get("Authorization")
    if response.status_code == 401 and expected and response.request.headers.get("Authorization") == expected:
        phase = case.meta.phase.name.value if case.meta is not None else "unknown"
        raise AssertionError(f"Configured bearer credential was rejected in {phase}.")


@schemathesis.hook
def after_load_schema(ctx, schema):
    # Native scalar overrides apply to every phase in 4.29.3. Consume the config
    # values as examples-only targets, leaving coverage/fuzzing free to draw ids.
    SEEDED_TARGETS.clear()
    SEEDED_ETAGS.clear()
    SEEDED_CREATE_BODIES.clear()
    SEEDED_PATCH_BODIES.clear()
    DOCUMENT_FIXTURES.clear()
    APPLICATION_FIXTURE.clear()
    FORMULATION_FIXTURE.clear()
    PARTY_FIXTURE.clear()
    fixture_path = os.environ.get("API_FUZZ_FIXTURE")
    if fixture_path:
        with open(fixture_path, encoding="utf-8") as fixture_file:
            fixture = json.load(fixture_file)
            DOCUMENT_FIXTURES.extend(fixture["documents"])
            if fixture.get("deleteSupplierId"):
                PARTY_FIXTURE.update(fixture)
            if fixture.get("deleteFormulationId"):
                FORMULATION_FIXTURE.update(fixture)
            if fixture.get("applicationId"):
                APPLICATION_FIXTURE.update(fixture)
    schema.config.parameters.pop("query.cursor", None)
    for result in schema.get_all_operations():
        operation = result.ok()
        if operation is None:
            continue
        config = schema.config.operations.get_for_operation(operation)
        target = config.parameters.pop("path.idOrCode", None)
        if target is not None:
            SEEDED_TARGETS[operation.label] = target
            etag = config.parameters.pop("header.If-Match", None)
            if etag is not None:
                SEEDED_ETAGS[operation.label] = etag
    facility = SEEDED_TARGETS.get("GET /facilities/{idOrCode}")
    bin_id = SEEDED_TARGETS.get("GET /storage-locations/{idOrCode}")
    # The public create examples' UUIDs describe the shape, not this seed's rows.
    # Bind only an Examples-phase dry run, leaving generated references random.
    create = schema["/feedstocks"]["POST"]
    body = deepcopy(create.definition.raw["requestBody"]["content"]["application/json"]["example"])
    references = {
        "facilityId": "GET /facilities/{idOrCode}",
        "supplierId": "GET /suppliers/{idOrCode}",
        "feedstockTypeId": "GET /feedstock-types/{idOrCode}",
    }
    if all(label in SEEDED_TARGETS for label in references.values()) and bin_id is not None:
        for field, label in references.items():
            body[field] = SEEDED_TARGETS[label]
        for allocation in body["allocations"]:
            allocation["storageLocationId"] = bin_id
        # seed.ts fixes the fixture facility's timezone to UTC.
        body["deliveryDate"] = datetime.now(timezone.utc).date().isoformat()
        SEEDED_CREATE_BODIES["POST /feedstocks"] = body
    # Runs draw from their own seeded bin, so the feedstock cases keep their stock.
    reactor = SEEDED_TARGETS.get("GET /reactors/{idOrCode}")
    run_bin = os.environ.get("API_FUZZ_RUN_BIN_ID")
    if facility is not None and reactor is not None and run_bin:
        run = deepcopy(schema["/production-runs"]["POST"].definition.raw["requestBody"]["content"]["application/json"]["example"])
        run.update(
            facilityId=facility, reactorId=reactor,
            startTime=(datetime.now(timezone.utc) - SEEDED_RUN_CREATE_START_AGE).isoformat(timespec="seconds"),
            feedstockDraws=[{"storageLocationId": run_bin, "wetMassKg": SEEDED_RUN_DRAW_WET_MASS_KG}],
            feedstockMoisturePercent=SEEDED_RUN_MOISTURE_PERCENT,
        )
        SEEDED_CREATE_BODIES["POST /production-runs"] = run
    # Products draw from the seeded biochar bin into the seeded product bin.
    pure = SEEDED_TARGETS.get("GET /formulations/{idOrCode}")
    biochar_bin = SEEDED_TARGETS.get("GET /storage-locations/{idOrCode}/stock-movements")
    product_bin = os.environ.get("API_FUZZ_PRODUCT_BIN_ID")
    if facility is not None and pure is not None and biochar_bin is not None and product_bin:
        product = deepcopy(schema["/biochar-products"]["POST"].definition.raw["requestBody"]["content"]["application/json"]["example"])
        product.update(
            facilityId=facility, formulationId=pure, ingredients=[], waterAddedKg=0,
            placedAt=(datetime.now(timezone.utc) - SEEDED_PRODUCT_PLACED_AGE).isoformat(timespec="seconds"),
            sourceBiocharStorageLocationId=biochar_bin, storageLocationId=product_bin,
            biocharWetMassKg=SEEDED_PRODUCT_BIOCHAR_WET_MASS_KG, biocharMoisturePercent=SEEDED_BIOCHAR_MOISTURE_PERCENT,
        )
        SEEDED_CREATE_BODIES["POST /biochar-products"] = product
    if biochar_bin is not None:
        movement = deepcopy(schema["/storage-locations/{idOrCode}/stock-movements"]["POST"].definition.raw["requestBody"]["content"]["application/json"]["example"])
        movement.update(
            kind="loss", wetMassKg=SEEDED_LOSS_WET_MASS_KG, moisturePercent=SEEDED_BIOCHAR_MOISTURE_PERCENT,
            occurredAt=(datetime.now(timezone.utc) - SEEDED_MOVEMENT_AGE).isoformat(timespec="seconds"),
        )
        SEEDED_CREATE_BODIES["POST /storage-locations/{idOrCode}/stock-movements"] = movement
    # Lab samples go onto the seeded credit batch (a 200-year facility, so no R0 or TGA).
    credit_batch = SEEDED_TARGETS.get("GET /credit-batches/{idOrCode}")
    if credit_batch is not None:
        sample = deepcopy(schema["/lab-samples"]["POST"].definition.raw["requestBody"]["content"]["application/json"]["example"])
        sample.update(
            creditBatchId=credit_batch,
            samplingTime=(datetime.now(timezone.utc) - SEEDED_LAB_SAMPLE_AGE).isoformat(timespec="seconds"),
        )
        SEEDED_CREATE_BODIES["POST /lab-samples"] = sample
    SEEDED_PATCH_BODIES["PATCH /lab-samples/{idOrCode}"] = deepcopy(SEEDED_LAB_SAMPLE_PATCH)
    customer = SEEDED_TARGETS.get("GET /customers/{idOrCode}")
    customer_location = os.environ.get("API_FUZZ_CUSTOMER_LOCATION_ID")
    if facility is not None and pure is not None and customer is not None and customer_location:
        order = deepcopy(schema["/orders"]["POST"].definition.raw["requestBody"]["content"]["application/json"]["example"])
        order.update(
            facilityId=facility, customerId=customer, customerLocationId=customer_location,
            formulationId=pure, orderDate=datetime.now(timezone.utc).date().isoformat(),
        )
        SEEDED_CREATE_BODIES["POST /orders"] = order
    SEEDED_PATCH_BODIES["PATCH /orders/{idOrCode}"] = deepcopy(SEEDED_ORDER_PATCH)
    order_id = SEEDED_TARGETS.get("GET /orders/{idOrCode}")
    if order_id is not None and product_bin:
        SEEDED_CREATE_BODIES["POST /deliveries"] = {
            "orderId": order_id, "storageLocationId": product_bin,
            "deliveredAt": (datetime.now(timezone.utc) - SEEDED_DELIVERY_AGE).isoformat(timespec="seconds"),
            "deliveredWetMassKg": SEEDED_DELIVERY_WET_MASS_KG,
            "moisturePercent": SEEDED_BIOCHAR_MOISTURE_PERCENT,
        }
    SEEDED_PATCH_BODIES["PATCH /deliveries/{idOrCode}"] = deepcopy(SEEDED_DELIVERY_PATCH)
    # An empty product patch is not a meaningful change, so the dry run sends the published example.
    SEEDED_PATCH_BODIES["PATCH /biochar-products/{idOrCode}"] = deepcopy(
        schema["/biochar-products/{idOrCode}"]["PATCH"].definition.raw["requestBody"]["content"]["application/json"]["example"])


@schemathesis.hook
def before_add_examples(ctx, examples):
    operation = ctx.operation
    add_document_examples(operation, examples)
    add_application_examples(operation, examples)
    add_formulation_examples(operation, examples)
    add_party_examples(operation, examples)
    add_location_examples(operation, examples)
    target = SEEDED_TARGETS.get(operation.label)
    create_body = SEEDED_CREATE_BODIES.get(operation.label)
    is_create = create_body is not None
    if target is None and not is_create:
        return
    metadata = CaseMetadata(
        generation=GenerationInfo(time=0, mode=GenerationMode.POSITIVE), components={},
        phase=PhaseInfo(name=TestPhase.EXAMPLES, data=ExamplesPhaseData(
            description=SEEDED_CREATE_DESCRIPTION if is_create else SEEDED_TARGET_DESCRIPTION,
            parameter=None if is_create else "idOrCode",
            parameter_location=ParameterLocation.BODY if is_create else ParameterLocation.PATH, location=None,
        )),
    )
    kwargs = {"_meta": metadata}
    if is_create:
        kwargs.update(query={"dryRun": "true"}, headers={"Idempotency-Key": str(uuid4())},
                      body=deepcopy(create_body), media_type="application/json")
    # A create under a seeded parent (stock movements) also pins the path id.
    if target is not None:
        kwargs["path_parameters"] = {"idOrCode": target}
    if operation.method.upper() in {"PATCH", "DELETE"}:
        kwargs.update(query={"dryRun": "true"}, headers={"If-Match": SEEDED_ETAGS[operation.label]},
                      body=deepcopy(SEEDED_PATCH_BODIES.get(operation.label, {})), media_type="application/json")
    examples.append(operation.Case(**kwargs))
    if is_create and operation.label == "POST /feedstocks":
        oversize = deepcopy(kwargs)
        oversize["body"]["notes"] = "x" * API_BODY_MAX_BYTES
        oversize["headers"]["Idempotency-Key"] = str(uuid4())
        oversize["_meta"].generation.mode = GenerationMode.NEGATIVE
        oversize["_meta"].phase.data.description = OVERSIZE_EXAMPLE_DESCRIPTION
        examples.append(operation.Case(**oversize))


@schemathesis.hook
def before_call(ctx, case, kwargs=None):
    if kwargs is not None and "/documents/" in case.operation.path and case.operation.path.endswith("/content"):
        kwargs["allow_redirects"] = False
    # No generated string can promise the organization/resource/filter binding.
    # Positive requests start on page one; negative cursor probes remain intact.
    if case.meta is not None and case.meta.generation.mode.is_positive and case.query:
        case.query.pop("cursor", None)
    # Schemathesis 4.29.3 can hand the fuzzing phase a positive case without a
    # required header (seen on creates with facility-local times). Supply the
    # Idempotency-Key it promised; coverage still sends the negative case.
    if case.meta is not None and case.meta.generation.mode.is_positive and requires_idempotency_key(case.operation):
        headers = case.headers if case.headers is not None else {}
        if not any(name.lower() == IDEMPOTENCY_HEADER.lower() for name in headers):
            headers[IDEMPOTENCY_HEADER] = str(uuid4())
            case.headers = headers
    meta = case.meta
    # Float multipleOf revalidation can label an exact decimal multiple negative.
    # Correct only that body component; other negative components still reject.
    if meta is not None and ParameterLocation.BODY in meta.components and meta.components[ParameterLocation.BODY].mode.is_negative and body_has_decimal_multiple_of_artifact(case):
        meta.components[ParameterLocation.BODY] = ComponentInfo(mode=GenerationMode.POSITIVE)
        meta.generation.mode = GenerationMode.NEGATIVE if any(info.mode.is_negative for info in meta.components.values()) else GenerationMode.POSITIVE
        meta.update_validated_hash(ParameterLocation.BODY, case._hash_container(case.body))
    # Stateful links in 4.29.3 can also drop a required If-Match. The request
    # violates the schema, so judge it as negative without guessing a live ETag.
    if meta is not None and meta.generation.mode.is_positive and any(
        parameter.name.lower() == IF_MATCH_HEADER.lower() and parameter.is_required
        for parameter in case.operation.headers
    ) and not any(name.lower() == IF_MATCH_HEADER.lower() for name in (case.headers or {})):
        meta.generation.mode = GenerationMode.NEGATIVE
        meta.components[ParameterLocation.HEADER] = ComponentInfo(mode=GenerationMode.NEGATIVE)
        # Track the header component even if the generator omitted its metadata.
        meta.update_validated_hash(ParameterLocation.HEADER, case._hash_container(case.headers))


def body_has_decimal_multiple_of_artifact(case):
    artifact = False

    class DecimalMultipleOf:
        def __init__(self, parent_schema, value, schema_path):
            self.divisor = Decimal(str(value))

        def validate(self, value):
            nonlocal artifact
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                return
            try:
                remainder = Decimal(str(value)) % self.divisor
            except DecimalException as exc:
                raise ValueError("Not an exact decimal multiple") from exc
            if remainder != 0:
                raise ValueError("Not an exact decimal multiple")
            artifact |= isinstance(value, float) and self.divisor != self.divisor.to_integral_value()

    try:
        if not case.media_type or not is_json(case.media_type) or not is_json_value(case.body):
            return False
        for alternative in case.operation.body:
            if alternative.media_type == case.media_type:
                validator = case.operation.schema.adapter.jsonschema_validator_cls(
                    alternative.validation_schema, validate_formats=True, offline=True,
                    pattern_options=FANCY_REGEX_OPTIONS, keywords={"multipleOf": DecimalMultipleOf},
                )
                return validator.is_valid(case.body) and artifact
    except Exception:
        # This optional correction must leave unrecognized negative cases intact.
        return False
    return False


def is_json_value(value):
    if type(value) is dict:
        return all(type(key) is str and is_json_value(item) for key, item in value.items())
    if type(value) is list:
        return all(is_json_value(item) for item in value)
    return value is None or type(value) in (str, int, float, bool)


def requires_idempotency_key(operation):
    return any(
        parameter.get("in") == "header" and parameter.get("name") == IDEMPOTENCY_HEADER and parameter.get("required")
        for parameter in operation.definition.raw.get("parameters", [])
    )


def document_metadata(description, negative=False):
    return CaseMetadata(
        generation=GenerationInfo(time=0, mode=GenerationMode.NEGATIVE if negative else GenerationMode.POSITIVE),
        components={}, phase=PhaseInfo(name=TestPhase.EXAMPLES, data=ExamplesPhaseData(
            description=description, parameter=None, parameter_location=ParameterLocation.BODY, location=None,
        )),
    )


def add_party_examples(operation, examples):
    if not PARTY_FIXTURE:
        return
    fixture = PARTY_FIXTURE
    operation_id = operation.definition.raw.get("operationId", "")
    for party in ("supplier", "customer"):
        kind = party.capitalize()
        if operation_id == f"create_{party}":
            location = {"name": "API fuzz place", "country": "TZ", "gpsLatitude": -8.12, "gpsLongitude": 36.45,
                        "facilityDistances": [{"facilityId": fixture["facilityId"], "distanceKm": LOCATION_DISTANCE_MIN_KM, "distanceSource": "manual"}]}
            for distance, count, negative in (
                (LOCATION_DISTANCE_MIN_KM, 1, False), (LOCATION_DISTANCE_MAX_KM, 1, False),
                (LOCATION_DISTANCE_MAX_KM + LOCATION_DISTANCE_MIN_KM, 1, True),
                (LOCATION_DISTANCE_SUBNORMAL_KM, 1, True),
                (LOCATION_DISTANCE_MIN_KM, PARTY_MAX_LOCATIONS, False),
                (LOCATION_DISTANCE_MIN_KM, PARTY_MAX_LOCATIONS + 1, True),
            ):
                places = [deepcopy(location) for _ in range(count)]
                for index, place in enumerate(places):
                    place["name"] = f"API fuzz place {index}"
                    place["facilityDistances"][0]["distanceKm"] = distance
                examples.append(operation.Case(
                    query={"dryRun": "true"}, headers={IDEMPOTENCY_HEADER: str(uuid4())}, media_type="application/json",
                    body={"name": f"API fuzz example {party}", "locations": places},
                    _meta=document_metadata(PARTY_BOUNDARY_REFUSAL_DESCRIPTION if negative else SEEDED_CREATE_DESCRIPTION, negative),
                ))
        targets = {f"update_{party}": party, f"delete_{party}": "delete" + kind,
                   f"archive_{party}": "archive" + kind, f"restore_{party}": "restore" + kind}
        if operation_id in targets:
            prefix = targets[operation_id]
            parameter, = operation.path_parameters
            body = {"sourceRegion" if party == "supplier" else "cropType": "API fuzz patch"} if operation_id == f"update_{party}" else {}
            examples.append(operation.Case(
                path_parameters={parameter.name: fixture[prefix + "Id"]},
                query={"dryRun": "true"}, headers={IF_MATCH_HEADER: fixture[prefix + "Etag"]},
                body=body, media_type="application/json", _meta=document_metadata(SEEDED_TARGET_DESCRIPTION),
            ))


def add_location_examples(operation, examples):
    if not PARTY_FIXTURE:
        return
    fixture = PARTY_FIXTURE
    command = operation.definition.raw.get("operationId", "")
    for party in ("supplier", "customer"):
        if command == f"get_{party}_location":
            values = {"idOrCode": fixture[party + "Id"], "locationId": fixture[party + "LocationId"]}
            examples.append(operation.Case(
                path_parameters={p.name: values[p.name] for p in operation.path_parameters},
                _meta=document_metadata(SEEDED_TARGET_DESCRIPTION),
            ))
        if command == f"add_{party}_location":
            for distance in (LOCATION_DISTANCE_MIN_KM, LOCATION_DISTANCE_MAX_KM):
                examples.append(operation.Case(
                    path_parameters={p.name: fixture[party + "Id"] for p in operation.path_parameters},
                    query={"dryRun": "true"}, headers={IDEMPOTENCY_HEADER: str(uuid4())}, media_type="application/json",
                    body={"name": "API fuzz added place", "country": "TZ", "gpsLatitude": -8.12, "gpsLongitude": 36.45,
                          "facilityDistances": [{"facilityId": fixture["facilityId"], "distanceKm": distance, "distanceSource": "manual"}]},
                    _meta=document_metadata(SEEDED_CREATE_DESCRIPTION),
                ))
        targets = {f"update_{party}_location": party + "Location", f"delete_{party}_location": "delete" + party.capitalize() + "Location"}
        if party == "customer":
            targets.update(archive_customer_location="archiveCustomerLocation", restore_customer_location="restoreCustomerLocation")
        if command in targets:
            prefix = targets[command]
            # Read both names from the operation, never substitute a parent id for locationId.
            values = {"idOrCode": fixture.get(prefix + "ParentId", fixture[party + "Id"]), "locationId": fixture[prefix + "Id"]}
            examples.append(operation.Case(
                path_parameters={p.name: values[p.name] for p in operation.path_parameters},
                query={"dryRun": "true"}, headers={IF_MATCH_HEADER: fixture[prefix + "Etag"]},
                body={"city": "API fuzz city"} if command.startswith("update_") else {}, media_type="application/json",
                _meta=document_metadata(SEEDED_TARGET_DESCRIPTION),
            ))


@schemathesis.check
def seeded_party_boundary_rejection(ctx, response, case):
    if case.meta is not None and case.meta.phase.name == TestPhase.EXAMPLES and case.meta.phase.data.description == PARTY_BOUNDARY_REFUSAL_DESCRIPTION:
        if response.status_code != 422:
            raise AssertionError("Out-of-range party distance or location count must return 422.")
        problem = response.json()
        if problem.get("code") != "validation_failed" or not any(
            issue.get("pointer") == "/locations" or issue.get("pointer", "").startswith("/locations/")
            for issue in problem.get("errors", [])
        ):
            raise AssertionError("Party boundary refusal must identify validation under /locations.")


def add_formulation_examples(operation, examples):
    if not FORMULATION_FIXTURE:
        return
    fixture = FORMULATION_FIXTURE
    command = operation.definition.raw.get("operationId")
    targets = {"update_formulation": "blendFormulation", "delete_formulation": "deleteFormulation",
               "archive_formulation": "archiveFormulation", "restore_formulation": "restoreFormulation"}
    if command == "create_formulation":
        for biochar, ingredient, negative in (
            (FORMULATION_BIOCHAR_RATIO, FORMULATION_COMPOST_RATIO, False),
            (FORMULATION_MIN_RATIO, FORMULATION_COMPLEMENT_RATIO, False),
            (FORMULATION_TOO_SMALL_RATIO, FORMULATION_COMPLEMENT_RATIO, True),
        ):
            examples.append(operation.Case(
                query={"dryRun": "true"}, headers={IDEMPOTENCY_HEADER: str(uuid4())}, media_type="application/json",
                body={"name": "API fuzz example blend", "biocharRatio": biochar,
                      "lines": [{"feedstockTypeId": fixture["blendFeedstockTypeId"], "ratio": ingredient}]},
                _meta=document_metadata(FORMULATION_RATIO_REFUSAL_DESCRIPTION if negative else SEEDED_CREATE_DESCRIPTION, negative),
            ))
    elif command in targets:
        prefix = targets[command]
        # OpenAPI currently names this idOrCode even though writes accept UUIDs
        # only. Read the parameter rather than inferring its name from the route.
        parameter, = operation.path_parameters
        body = {"biocharRatio": FORMULATION_MIN_RATIO, "lines": [
            {"feedstockTypeId": fixture["blendFeedstockTypeId"], "ratio": FORMULATION_COMPLEMENT_RATIO},
        ]} if command == "update_formulation" else {}
        examples.append(operation.Case(
            path_parameters={parameter.name: fixture[prefix + "Id"]},
            query={"dryRun": "true"}, headers={IF_MATCH_HEADER: fixture[prefix + "Etag"]},
            body=body, media_type="application/json", _meta=document_metadata(SEEDED_TARGET_DESCRIPTION),
        ))


@schemathesis.check
def seeded_formulation_ratio_rejection(ctx, response, case):
    if case.meta is None or case.meta.phase.name != TestPhase.EXAMPLES or case.meta.phase.data.description != FORMULATION_RATIO_REFUSAL_DESCRIPTION:
        return
    if response.status_code != 422:
        raise AssertionError("Sub-millionth formulation ratio must return 422.")
    problem = response.json()
    if problem.get("code") != "validation_failed" or not any(issue.get("pointer") == "/biocharRatio" for issue in problem.get("errors", [])):
        raise AssertionError("Sub-millionth refusal must identify /biocharRatio.")


def add_application_examples(operation, examples):
    if not APPLICATION_FIXTURE:
        return
    fixture = APPLICATION_FIXTURE
    targets = {
        "GET /applications": None,
        "GET /applications/{idOrCode}": fixture["applicationId"],
        "GET /applications/{idOrCode}/boundary": fixture["applicationId"],
        "GET /deliveries/{idOrCode}/application-balance": fixture["applicationDeliveryId"],
        "POST /applications": None,
    }
    if operation.label not in targets:
        return
    create = operation.method.upper() == "POST"
    kwargs = {"_meta": document_metadata(SEEDED_CREATE_DESCRIPTION if create else SEEDED_TARGET_DESCRIPTION)}
    if targets[operation.label]:
        kwargs["path_parameters"] = {"idOrCode": targets[operation.label]}
    if operation.label == "GET /applications":
        kwargs["query"] = {"deliveryId": fixture["applicationDeliveryId"]}
    if create:
        kwargs.update(query={"dryRun": "true"}, headers={IDEMPOTENCY_HEADER: str(uuid4())},
                      media_type="application/json", body={
                          "deliveryId": fixture["applicationDeliveryId"],
                          "applicationDate": fixture["applicationDate"],
                          "appliedWetMassKg": SEEDED_APPLICATION_WET_MASS_KG,
                          "fieldSizeHa": SEEDED_APPLICATION_FIELD_SIZE_HA, "evidenceMethod": "location",
                          "gpsLatitude": fixture["applicationGpsLatitude"], "gpsLongitude": fixture["applicationGpsLongitude"],
                      })
    # Saved tags are not refreshed after stateful writes. No positive PATCH;
    # the fuzz credential deliberately lacks applications:delete.
    examples.append(operation.Case(**kwargs))


def add_document_examples(operation, examples):
    for fixture in DOCUMENT_FIXTURES:
        path = "/" + DOCUMENT_PATHS[fixture["ownerType"]] + "/{idOrCode}/documents"
        if operation.path not in {path, path + "/{documentId}", path + "/{documentId}/content", path + "/{documentId}/confirm"}:
            continue
        method = operation.method.upper()
        if method not in {"GET", "POST"}:
            continue
        kwargs = {"path_parameters": {"idOrCode": fixture["ownerId"]},
                  "_meta": document_metadata(DOCUMENT_SUCCESS_DESCRIPTION)}
        if "{documentId}" in operation.path:
            kwargs["path_parameters"]["documentId"] = fixture["uploaded"]["id"]
        if operation.path.endswith("/content"):
            if not fixture["uploaded"].get("physicalObject"):
                continue
            kwargs["_meta"] = document_metadata(DOCUMENT_CONTENT_DESCRIPTION)
        if method == "POST":
            kwargs.update(body={}, media_type="application/json")
            if operation.path == path:
                kwargs["headers"] = {IDEMPOTENCY_HEADER: str(uuid4())}
                kwargs["body"] = {"documentType": fixture["documentType"], "fileName": "fuzz-request.pdf",
                                  "contentType": "image/png" if fixture["documentType"] == "photo" else "application/pdf", "sizeBytes": 8, "sha256": "a" * 64}
        examples.append(operation.Case(**kwargs))
        if operation.path.endswith("/confirm"):
            negative = deepcopy(kwargs)
            negative["path_parameters"]["documentId"] = fixture["pending"]["id"]
            negative["_meta"] = document_metadata(DOCUMENT_PENDING_DESCRIPTION, negative=True)
            examples.append(operation.Case(**negative))


@schemathesis.check
def seeded_document_content_redirect(ctx, response, case):
    if case.meta is not None and case.meta.phase.name == TestPhase.EXAMPLES and case.meta.phase.data.description == DOCUMENT_CONTENT_DESCRIPTION:
        if response.status_code != 302 or not response.headers.get("location"):
            raise AssertionError("Seeded document content must return a download redirect.")
        if response.headers.get("cache-control") != ["private, no-store"]:
            raise AssertionError("Seeded document content must not be cached.")


@schemathesis.check
def seeded_pending_document_unchanged(ctx, response, case):
    if case.meta is None or case.meta.phase.name != TestPhase.EXAMPLES or case.meta.phase.data.description != DOCUMENT_PENDING_DESCRIPTION:
        return
    if response.status_code != 409 or response.json().get("code") != "conflict" or response.json().get("retryable") is not True:
        raise AssertionError("Pending confirmation without bytes must return retryable 409 conflict.")
    fixture = next(item for item in DOCUMENT_FIXTURES if item["pending"]["id"] == case.path_parameters["documentId"])
    path = f"/{DOCUMENT_PATHS[fixture['ownerType']]}/{fixture['ownerId']}/documents/{fixture['pending']['id']}"
    # Read only the API representation. Never follow storage links or PUT bytes.
    current = requests.get(os.environ["API_FUZZ_BASE_URL"].rstrip("/") + path,
                           headers={"Authorization": "Bearer " + os.environ["API_FUZZ_KEY"]},
                           timeout=DOCUMENT_TIMEOUT_SECONDS, allow_redirects=False)
    if current.status_code != 200 or current.json().get("data") != fixture["pending"]["data"] or current.headers.get("ETag") != fixture["pending"]["etag"]:
        raise AssertionError("Pending confirmation changed the seeded document.")
