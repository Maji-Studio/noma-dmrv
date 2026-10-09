"""Schemathesis 4.29.3 adaptations for opaque inputs and local HTTP transport."""

import os
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import schemathesis
from schemathesis.core.parameters import ParameterLocation
from schemathesis.generation import GenerationMode
from schemathesis.generation.meta import CaseMetadata, ExamplesPhaseData, GenerationInfo, PhaseInfo, TestPhase
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
SEEDED_TARGETS = {}
SEEDED_ETAGS = {}
SEEDED_CREATE_BODIES = {}


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
    else:
        kwargs["path_parameters"] = {"idOrCode": target}
    if operation.method.upper() in {"PATCH", "DELETE"}:
        kwargs.update(query={"dryRun": "true"}, headers={"If-Match": SEEDED_ETAGS[operation.label]}, body={}, media_type="application/json")
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
