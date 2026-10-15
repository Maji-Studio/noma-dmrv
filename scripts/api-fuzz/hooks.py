"""Schemathesis 4.29.3 adaptations for opaque inputs and local HTTP transport."""

import os
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal, DecimalException
from uuid import uuid4

import schemathesis
from schemathesis.core.jsonschema import FANCY_REGEX_OPTIONS
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
    if case.meta is not None and case.meta.phase.name == TestPhase.EXAMPLES and case.meta.phase.data.description in SEEDED_SUCCESS_DESCRIPTIONS:
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
def before_call(ctx, case, **kwargs):
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

    for alternative in case.operation.body:
        if alternative.media_type == case.media_type:
            validator = case.operation.schema.adapter.jsonschema_validator_cls(
                alternative.validation_schema, validate_formats=True, offline=True,
                pattern_options=FANCY_REGEX_OPTIONS, keywords={"multipleOf": DecimalMultipleOf},
            )
            return validator.is_valid(case.body) and artifact
    return False


def requires_idempotency_key(operation):
    return any(
        parameter.get("in") == "header" and parameter.get("name") == IDEMPOTENCY_HEADER and parameter.get("required")
        for parameter in operation.definition.raw.get("parameters", [])
    )
