"""Schemathesis 4.29.3 adaptations for opaque inputs and local HTTP transport."""

from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

import schemathesis
from schemathesis.core.parameters import ParameterLocation
from schemathesis.generation import GenerationMode
from schemathesis.generation.meta import CaseMetadata, ExamplesPhaseData, GenerationInfo, PhaseInfo, TestPhase
from schemathesis.specs.openapi.checks import status_code_conformance

TRANSPORT_REJECTIONS = frozenset({414, 431})
SEEDED_TARGETS = {}
SEEDED_ETAGS = {}
SEEDED_CREATE_BODY = None


@schemathesis.check
def application_status_code_conformance(ctx, response, case):
    # Node/Vercel can reject an oversized URI/header block before app code runs.
    # These responses have no application contract. All other statuses are checked.
    if response.status_code in TRANSPORT_REJECTIONS:
        return None
    return status_code_conformance(ctx, response, case)


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
    global SEEDED_CREATE_BODY
    SEEDED_CREATE_BODY = None
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
    # The public create example's UUIDs describe the shape, not this seed's rows.
    # Bind only an Examples-phase dry run, leaving generated references random.
    create = schema["/feedstocks"]["POST"]
    body = deepcopy(create.definition.raw["requestBody"]["content"]["application/json"]["example"])
    references = {
        "facilityId": "GET /facilities/{idOrCode}",
        "supplierId": "GET /suppliers/{idOrCode}",
        "feedstockTypeId": "GET /feedstock-types/{idOrCode}",
    }
    if all(label in SEEDED_TARGETS for label in references.values()) and "GET /storage-locations/{idOrCode}" in SEEDED_TARGETS:
        for field, label in references.items():
            body[field] = SEEDED_TARGETS[label]
        for allocation in body["allocations"]:
            allocation["storageLocationId"] = SEEDED_TARGETS["GET /storage-locations/{idOrCode}"]
        # seed.ts fixes the fixture facility's timezone to UTC.
        body["deliveryDate"] = datetime.now(timezone.utc).date().isoformat()
        SEEDED_CREATE_BODY = body


@schemathesis.hook
def before_add_examples(ctx, examples):
    operation = ctx.operation
    target = SEEDED_TARGETS.get(operation.label)
    is_create = operation.label == "POST /feedstocks" and SEEDED_CREATE_BODY is not None
    if target is None and not is_create:
        return
    metadata = CaseMetadata(
        generation=GenerationInfo(time=0, mode=GenerationMode.POSITIVE), components={},
        phase=PhaseInfo(name=TestPhase.EXAMPLES, data=ExamplesPhaseData(
            description="Seeded fixture create" if is_create else "Seeded fixture target",
            parameter=None if is_create else "idOrCode",
            parameter_location=ParameterLocation.BODY if is_create else ParameterLocation.PATH, location=None,
        )),
    )
    kwargs = {"_meta": metadata}
    if is_create:
        kwargs.update(query={"dryRun": "true"}, headers={"Idempotency-Key": str(uuid4())},
                      body=deepcopy(SEEDED_CREATE_BODY), media_type="application/json")
    else:
        kwargs["path_parameters"] = {"idOrCode": target}
    if operation.method.upper() in {"PATCH", "DELETE"}:
        kwargs.update(query={"dryRun": "true"}, headers={"If-Match": SEEDED_ETAGS[operation.label]}, body={}, media_type="application/json")
    examples.append(operation.Case(**kwargs))


@schemathesis.hook
def before_call(ctx, case, **kwargs):
    # No generated string can promise the organization/resource/filter binding.
    # Positive requests start on page one; negative cursor probes remain intact.
    if case.meta is not None and case.meta.generation.mode.is_positive and case.query:
        case.query.pop("cursor", None)
