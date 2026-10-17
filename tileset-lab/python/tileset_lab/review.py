"""Closed independent native image review, external receipts, exact selection.

Coverage is declared independently BEFORE native work, then content-bound after
computational proof. This code never emits visual PASS observations. TEST-ONLY
review records exercise parsing only and cannot produce a publishable receipt.
"""
from __future__ import annotations

import os
from pathlib import PurePosixPath
import platform
import signal
import stat
import uuid

from .manifest import (Inputs, array, boolean, closed, digest, identifier, integer, json_bytes,
                       parse_json, rectangle, relative_path, require, sha256, text, unique)
from .sources import tool_identity

# Complete bindings plus specific observations for every required image exceed
# 128MiB on the real matrix. This PRIVATE evidence limit is not the 256KiB CLI
# report bound; full coverage must not require abbreviated/fabricated findings.
REVIEW_LIMIT = 256*1024*1024


def file_record(root, path):
    content = root.read(path)[0]
    return {"path": path, "size_bytes": len(content), "sha256": sha256(content)}


def check_file(root, record):
    closed(record, ("path", "size_bytes", "sha256"), "bound evidence file")
    relative_path(record["path"])
    integer(record["size_bytes"], "bound byte size")
    digest(record["sha256"])
    require(file_record(root, record["path"]) == record, f"Missing/stale bound evidence: {record['path']}")
    return record


def _read_json(root, path):
    content = root.read(path)[0]
    require(len(content) <= REVIEW_LIMIT, "Oversized review/proof JSON; no partial parse")
    return parse_json(content, path)


def freeze(inputs, manifest, candidate, directory, coverage_path, computational_path, runtime_path, approval, producer):
    root = inputs.root
    from .sources import validate_inventory
    validate_inventory(Inputs(root), manifest)
    inputs.recheck()
    files = [file_record(root, path) for path in root.files(directory)]
    seal = {"schema_version": 1, "consumer": manifest["id"], "candidate": candidate,
            "directory": directory, "source_approval": approval, "producer": producer,
            "tool_sha256": tool_identity()["sha256"], "protected_inputs": inputs.hashes(),
            "files": files, "coverage": file_record(root, coverage_path),
            "computational": file_record(root, computational_path), "runtime": file_record(root, runtime_path)}
    path = f"{manifest['output_root']}/proofs/{candidate}-seal.json"
    root.write(path, json_bytes(seal))
    return file_record(root, path), seal


def verify_seal(inputs, manifest, candidate, seal_path):
    root = inputs.root
    require(seal_path == f"{manifest['output_root']}/proofs/{candidate}-seal.json", "Wrong immutable candidate seal path")
    seal_content = inputs.read(seal_path)
    require(len(seal_content) <= REVIEW_LIMIT, "Oversized immutable seal")
    seal = closed(parse_json(seal_content, seal_path), ("schema_version", "consumer", "candidate", "directory", "source_approval", "producer",
                    "tool_sha256", "protected_inputs", "files", "coverage", "computational", "runtime"), "immutable bundle seal")
    require(type(seal["schema_version"]) is int and seal["schema_version"] == 1 and seal["consumer"] == manifest["id"]
            and seal["candidate"] == candidate and seal["directory"] == f"{manifest['output_root']}/candidates/{candidate}", "Wrong immutable bundle identity")
    require(tool_identity()["sha256"] == seal["tool_sha256"], "Stale frozen tool/dependency identity")
    require(type(seal["protected_inputs"]) is dict, "Malformed protected input inventory")
    for path, expected in seal["protected_inputs"].items():
        relative_path(path)
        digest(expected)
        require(sha256(inputs.read(path)) == expected, f"Protected input/source review changed: {path}")
    rows = array(seal["files"], "frozen exact payload/evidence", True)
    unique([r["path"] for r in rows], "frozen payload paths")
    directory = PurePosixPath(seal["directory"])
    for row in rows:
        require(directory in PurePosixPath(row["path"]).parents, "Frozen inventory escapes exact bundle")
        check_file(root, row)
    require(set(root.files(seal["directory"])) == {r["path"] for r in rows}, "Frozen bundle missing/extra files")
    for key in ("coverage", "computational", "runtime"):
        check_file(root, seal[key])
        require(seal[key] in rows, f"{key} not frozen inside exact bundle")
    runtime = _read_json(root, seal["runtime"]["path"])
    from .native import runtime_content
    current = runtime_content(manifest["tiled_runtime"])
    require(current["sha256"] == runtime["sha256"], "Stale runtime/platform/display/dependency CONTENT identity")
    from .sources import validate_inventory
    validate_inventory(Inputs(root), manifest)
    inputs.recheck()
    return {"path": seal_path, "size_bytes": len(seal_content), "sha256": sha256(seal_content)}, seal


def draft_review(root, manifest, candidate, seal_record, seal, coverage):
    """UNAPPROVED records only. Another reviewer must view and author findings."""
    path = f"{manifest['output_root']}/reviews/{candidate}-native-draft.json"
    draft = {"schema_version": 1, "status": "UNAPPROVED", "consumer": manifest["id"], "candidate": candidate,
             "seal": seal_record, "coverage": seal["coverage"],
             "reviewer": {"id": "", "kind": "independent", "independent_of": coverage["independent_of"], "image_capable": False},
             "verdict": "BLOCKED", "entries": [{"binding": binding, "viewed": [], "observations": "", "verdict": "BLOCKED"}
                                                  for binding in coverage["bindings"]]}
    root.write(path, json_bytes(draft))
    return file_record(root, path)


def _check_binding(root, binding):
    closed(binding, ("id", "consumer", "kind", "pack", "family", "mode", "case", "stage", "context", "elapsed_ms", "intent",
                     "field_sha256", "recipe_sha256", "expected_inventory_sha256", "source_approval_sha256", "tool_sha256",
                     "dependency_sha256", "runtime_sha256", "tsx", "atlases_original_rectangles", "native_tmx", "logs", "native_png",
                     "crops", "pages", "required_views"), "closed native visual binding")
    text(binding["id"], "native item identity")
    identifier(binding["consumer"], "native consumer")
    require(binding["kind"] in ("draw-stage", "source-inventory", "playback", "terrain-masks", "complete-parts", "terrain-pattern", "scene"), "Unknown native context kind")
    integer(binding["elapsed_ms"], "native elapsed time")
    text(binding["intent"], "independent semantic intent")
    for key in ("field_sha256", "recipe_sha256", "expected_inventory_sha256", "source_approval_sha256", "tool_sha256", "dependency_sha256", "runtime_sha256"):
        digest(binding[key], key)
    if binding["kind"] == "draw-stage":
        for key in ("pack", "family", "case", "stage"):
            identifier(binding[key], key)
        require(binding["mode"] in ("opaque", "alpha") and binding["context"] is None and binding["elapsed_ms"] == 0, "Invalid draw stage identity")
    else:
        require(all(binding[k] is None for k in ("pack", "family", "mode", "case", "stage")), "Invalid native art context identity")
        identifier(binding["context"], "native gallery/scene context")
    for key in ("native_tmx", "native_png"):
        check_file(root, binding[key])
    require(binding["native_tmx"]["path"].endswith(".tmx") and binding["native_png"]["path"].endswith(".png"), "Wrong native map/image file kind")
    for key in ("tsx", "atlases_original_rectangles", "logs", "required_views"):
        rows = array(binding[key], key, True)
        unique([row["path"] for row in rows], key)
        for row in rows:
            check_file(root, row)
    require(all(row["path"].endswith(".tsx") for row in binding["tsx"]), "Wrong native external tileset kind")
    require(all(row["path"].endswith(".png") for row in binding["required_views"]), "Viewed source/native evidence must be actual PNG")
    crops = array(binding["crops"], "FULL prescribed native crops", True)
    unique([crop["id"] for crop in crops], "native crop identities")
    for crop in crops:
        keys = ("id", "pixel_rect", "actual", "expected", "actual_file", "expected_file")
        closed(crop, keys if binding["kind"] == "draw-stage" else (*keys, "entity"), "native prescribed crop")
        identifier(crop["id"], "native crop id")
        rectangle(crop["pixel_rect"], "native pixel crop geometry")
        for key in ("actual", "expected"):
            require(crop[key] == crop[f"{key}_file"]["path"], "Crop file/geometry identity mismatch")
            check_file(root, crop[f"{key}_file"])
    pages = array(binding["pages"], "FULL prescribed native pages", True)
    unique([page["id"] for page in pages], "native page identities")
    for page in pages:
        keys = ("id", "path", "file", "dimensions", "integer_nearest_zoom")
        closed(page, keys if binding["kind"] == "draw-stage" else (*keys, "context", "pixel_rect"), "native prescribed page")
        identifier(page["id"], "native page id")
        require(type(page["dimensions"]) is list and len(page["dimensions"]) == 2, "Page dimensions required")
        for number in page["dimensions"]:
            integer(number, "page dimension", 1)
            require(number <= 2000, "Native review page exceeds 2000px")
        integer(page["integer_nearest_zoom"], "integer nearest zoom", 1)
        require(page["path"] == page["file"]["path"], "Native page file identity mismatch")
        check_file(root, page["file"])
        if binding["kind"] != "draw-stage":
            rectangle(page["pixel_rect"], "native page crop geometry")
            require(page["context"] in ("ground", "checker"), "Unknown native page context")
    return binding


def check_review(root, manifest, candidate, seal_record, seal, review_path, *, allow_test_trust=False):
    relative_path(review_path)
    require(PurePosixPath(seal["directory"]) not in PurePosixPath(review_path).parents,
            "Reviewer records must remain outside frozen hash boundary")
    snapshot = root.read(review_path)
    require(len(snapshot[0]) <= REVIEW_LIMIT, "Oversized native review")
    review = closed(parse_json(snapshot[0], review_path), ("schema_version", "status", "consumer", "candidate", "seal", "coverage", "reviewer", "verdict", "entries"), "native independent visual review")
    require(type(review["schema_version"]) is int and review["schema_version"] == 1 and review["consumer"] == manifest["id"]
            and review["candidate"] == candidate and review["status"] == "REVIEWED", "Missing/unapproved/wrong native visual review identity")
    require(review["seal"] == seal_record and review["coverage"] == seal["coverage"], "Stale native review frozen/expected inventory binding")
    coverage = closed(_read_json(root, seal["coverage"]["path"]), ("schema_version", "consumer", "candidate", "expected_inventory", "independent_of", "bindings"), "native coverage declaration")
    require(type(coverage["schema_version"]) is int and coverage["schema_version"] == 1 and coverage["consumer"] == manifest["id"]
            and coverage["candidate"] == candidate, "Wrong native expected coverage")
    expected = {row["id"]: _check_binding(root, row) for row in array(coverage["bindings"], "FULL expected review inventory", True)}
    require(len(expected) == len(coverage["bindings"]), "Duplicate expected review identity")
    reviewer = closed(review["reviewer"], ("id", "kind", "independent_of", "image_capable"), "native reviewer identity")
    text(reviewer["id"], "actual reviewer identity")
    boolean(reviewer["image_capable"], "actual image capability")
    require(reviewer["image_capable"] and reviewer["independent_of"] == coverage["independent_of"]
            and reviewer["id"] not in coverage["independent_of"], "Unavailable/self-authored native image approval")
    test_only = reviewer["kind"] == "TEST-ONLY"
    require(reviewer["kind"] in ("independent", "TEST-ONLY"), "Unknown native review trust kind")
    require(not test_only or allow_test_trust and reviewer["id"].startswith("TEST-ONLY:"), "Native TEST-ONLY approval requires explicit parser test trust")
    require(test_only or not reviewer["id"].startswith("TEST-ONLY:"), "Test trust cannot impersonate an independent visual reviewer")
    require(review["verdict"] == "PASS", "Native independent visual verdict is BLOCKED")
    actual = {}
    for entry in array(review["entries"], "native visual entries", True):
        closed(entry, ("binding", "viewed", "observations", "verdict"), "native visual entry")
        binding = entry["binding"]
        require(type(binding) is dict and binding.get("id") in expected and binding["id"] not in actual, "Unknown/duplicate/partial native visual coverage")
        # Equality must preserve JSON types: True is not integer 1, False is
        # not 0. The expected closed schema is already checked above.
        require(json_bytes(binding) == json_bytes(expected[binding["id"]]), "Stale/forged case/stage/image/crop/page/source/field/recipe/tool/runtime/native/log binding")
        require(entry["verdict"] == "PASS", f"Negative native semantic observation: {binding['id']}")
        observations = text(entry["observations"], "specific native semantic observations")
        require(len(observations.strip()) >= 40, "Missing specific native semantic findings")
        require(not test_only or "TEST-ONLY" in observations, "Synthetic visual test must identify TEST-ONLY, not actual image viewing")
        viewed = {}
        for image in array(entry["viewed"], "actual viewed PNG/crop/page/source records", True):
            closed(image, ("path", "sha256", "observations"), "viewed native/source image")
            require(image["path"] not in viewed, "Duplicate viewed image record")
            relative_path(image["path"])
            digest(image["sha256"])
            require(len(text(image["observations"], "specific image observation").strip()) >= 20, "Empty image observation")
            viewed[image["path"]] = image["sha256"]
        required = {r["path"]: r["sha256"] for r in binding["required_views"]}
        require(viewed == required, "Missing/extra/stale actual case/stage/crop/page/original image viewing record")
        for record in binding["required_views"]:
            check_file(root, record)
        actual[binding["id"]] = entry
    require(set(actual) == set(expected), "Incomplete native visual inventory; reported totals do not grant coverage")
    require(root.read(review_path) == snapshot, "Native review changed/replaced while validating its bytes")
    return {"path": review_path, "sha256": sha256(snapshot[0]), "reviewer": reviewer,
            "entries": len(actual), "test_only": test_only, "actual_visual_approval": not test_only}


def write_receipt(inputs, manifest, candidate, receipt_id, seal_record, seal, approval, computational):
    identifier(receipt_id, "receipt id")
    require(not approval["test_only"] and not seal["source_approval"]["test_only"], "TEST-ONLY source/native records cannot create a publication receipt")
    path = f"{manifest['output_root']}/receipts/{receipt_id}.json"
    record = {"schema_version": 1, "status": "APPROVED", "consumer": manifest["id"], "candidate": candidate,
              "seal": seal_record, "source_approval": seal["source_approval"], "native_review": approval,
              "computational": seal["computational"], "coverage": seal["coverage"], "tool_sha256": seal["tool_sha256"],
              "bundle_sha256": sha256(json_bytes(seal["files"])), "protected_inputs": seal["protected_inputs"]}
    # Review parsing is a long, fallible boundary. Recheck the COMPLETE sealed
    # payload and current external runtime after it, not only cached originals.
    current_record, current = verify_seal(inputs, manifest, candidate, seal_record["path"])
    require(current_record == seal_record and current == seal,
            "Complete candidate/seal changed after native review; no receipt")
    require(sha256(inputs.root.read(approval["path"])[0]) == approval["sha256"],
            "Native review changed before receipt")
    inputs.recheck()
    inputs.root.write(path, json_bytes(record))
    return file_record(inputs.root, path)


def select_exact(root, selector, content, final_check, finalize=None, deliver=None):
    """One descriptor-relative selector rename, never arbitrary multifile atomicity.

    Keep old selector bytes for exception rollback. Foreign/replaced selector or
    staging identity is ownership uncertainty, not permission for cleanup.
    """
    previous = root.read(selector) if root.exists(selector) else None
    staged = str(PurePosixPath(selector).parent/f".selector-{uuid.uuid4().hex}.json")
    root.write(staged, content)
    staged_snapshot = root.read(staged)
    require(staged_snapshot[0] == content, "Selector staging content differs")
    # Recovery bytes must already be durable BEFORE replacement. A filesystem
    # write failure after commit cannot require another successful file write.
    rollback = str(PurePosixPath(selector).parent/f".rollback-{uuid.uuid4().hex}.json") if previous else None
    rollback_snapshot = None
    committed = False
    try:
        if rollback:
            root.write(rollback, previous[0])
            rollback_snapshot = root.read(rollback)
        final_check()
        if previous:
            require(root.read(selector) == previous, "Approved selector changed during publication")
        else:
            require(not root.exists(selector), "Foreign selector appeared during publication")
        from .native import defer_cancellation
        with root.parent(selector) as (fd, name):
            stage_name = PurePosixPath(staged).name
            # Persist recovery's directory entry BEFORE changing the selector.
            os.fsync(fd)
            require(root.read(staged) == staged_snapshot, "Selector staging content/identity changed")
            root.check_root()
            # A real rename followed immediately by TERM must still record its
            # ownership transition before delivering cancellation to rollback.
            with defer_cancellation():
                os.replace(stage_name, name, src_dir_fd=fd, dst_dir_fd=fd)
                committed = True
                require(root.read(selector) == staged_snapshot, "Selected content/identity differs from exact staging")
                os.fsync(fd)
        final_check()
        require(root.read(selector) == staged_snapshot, "Selected content/identity changed before finalization")
        # CLI full-report serialization, bounded-report checks and delivery are
        # part of selection, not a later fallible operation after rollback ends.
        result = finalize() if finalize is not None else None
        final_check()
        require(root.read(selector) == staged_snapshot, "Selected content/identity changed during finalization")
        # No fallible selector/candidate/settlement check may follow success
        # delivery. Delivery failure itself still enters ownership-aware recovery.
        if deliver is not None:
            deliver(result)
        return result
    except BaseException:
        # A second TERM/INT must not interrupt ownership checks or recovery.
        old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, (signal.SIGINT, signal.SIGTERM))
        try:
            _restore_selection(root, selector, previous, staged, staged_snapshot,
                               rollback, rollback_snapshot, committed)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
        raise


def _restore_selection(root, selector, previous, staged, staged_snapshot,
                       rollback, rollback_snapshot, committed):
    if not committed and root.exists(staged):
        require(root.read(staged) == staged_snapshot, "Selector staging ownership/content uncertain; no cleanup")
        with root.parent(staged) as (fd, name):
            os.unlink(name, dir_fd=fd)
            os.fsync(fd)
    if committed:
        # Corrupt bytes on our pinned inode are a validation failure we can
        # recover. A different inode, even with identical bytes, is foreign.
        require(root.read(selector)[1] == staged_snapshot[1], "Selected file replaced; rollback ownership uncertain")
        if previous:
            require(root.read(rollback) == rollback_snapshot and rollback_snapshot[0] == previous[0],
                    "Prepared rollback replaced; recovery ownership uncertain")
            with root.parent(selector) as (fd, name):
                os.replace(PurePosixPath(rollback).name, name, src_dir_fd=fd, dst_dir_fd=fd)
                os.fsync(fd)
        else:
            with root.parent(selector) as (fd, name):
                os.unlink(name, dir_fd=fd)
                os.fsync(fd)


def publish_candidate(inputs, manifest, manifest_path, candidate, receipt_path, *, finalize=None, deliver=None):
    """Revalidate source, real native computation and actual independent review;
    select the EXACT already-frozen path and bytes without native work/rebuild.
    """
    from .validate import computational_validation
    root = inputs.root
    require(root.lock_identity is not None, "Whole-consumer publication lock required")
    identifier(candidate, "candidate id")
    relative_path(receipt_path)
    require(PurePosixPath(f"{manifest['output_root']}/receipts") in PurePosixPath(receipt_path).parents, "Publication receipt must be consumer-owned outside bundle")
    receipt_content = inputs.read(receipt_path)
    receipt = closed(parse_json(receipt_content, receipt_path), ("schema_version", "status", "consumer", "candidate", "seal", "source_approval", "native_review",
                    "computational", "coverage", "tool_sha256", "bundle_sha256", "protected_inputs"), "publication receipt")
    require(type(receipt["schema_version"]) is int and receipt["schema_version"] == 1 and receipt["status"] == "APPROVED"
            and receipt["consumer"] == manifest["id"] and receipt["candidate"] == candidate, "Missing/negative/wrong receipt identity")
    seal_record, seal = verify_seal(inputs, manifest, candidate, receipt["seal"]["path"])
    require(receipt["seal"] == seal_record and all(receipt[k] == seal[k] for k in ("source_approval", "computational", "coverage", "tool_sha256", "protected_inputs")), "Stale publication proof binding")
    require(not seal["source_approval"]["test_only"] and seal["source_approval"]["actual_visual_approval"], "Source TEST-ONLY/missing native publication authority")
    computational = computational_validation(inputs, manifest, manifest_path, candidate)
    inputs.read(receipt["native_review"]["path"])
    approval = check_review(root, manifest, candidate, seal_record, seal, receipt["native_review"]["path"])
    require(approval == receipt["native_review"] and approval["actual_visual_approval"], "Missing/stale/TEST-ONLY native approval")
    before = sha256(json_bytes(seal["files"]))
    require(before == receipt["bundle_sha256"], "Wrong exact bundle receipt digest")
    selector = f"{manifest['output_root']}/approved-selector.json"
    selector_content = json_bytes({"schema_version": 1, "consumer": manifest["id"], "candidate": candidate,
                       "candidate_path": seal["directory"], "bundle_sha256": before,
                       "seal": seal_record, "receipt": file_record(root, receipt_path)})
    def final_check():
        inputs.recheck()
        require(root.read(receipt_path)[0] == receipt_content, "Receipt changed before/after publication")
        require(sha256(root.read(approval["path"])[0]) == approval["sha256"], "Native reviewer changed before/after publication")
        current_record, current = verify_seal(inputs, manifest, candidate, seal_record["path"])
        require(current_record == seal_record and current == seal and sha256(json_bytes(current["files"])) == before,
                "Complete immutable seal/bundle changed during selection")
    prepared = None
    def finish():
        nonlocal prepared
        report = {"schema_version": 1, "operation": "build", "status": "PUBLISHED", "consumer": manifest["id"],
                  "id": candidate, "candidate_path": seal["directory"], "selected": True,
                  "bundle_sha256_before": before, "bundle_sha256_after": before,
                  "receipt": file_record(root, receipt_path), "selector": file_record(root, selector),
                  "source_approval": seal["source_approval"], "native_review": approval, "native_proof": True,
                  "native_visual_approval": True, "counts": computational["counts"], "owned_paths": [selector],
                  "tool_sha256": seal["tool_sha256"], "rebuilt": False}
        if finalize is not None:
            prepared = finalize(report)
        return report
    def delivery(report):
        deliver(prepared)
    return select_exact(root, selector, selector_content, final_check, finish, delivery if deliver is not None else None)
