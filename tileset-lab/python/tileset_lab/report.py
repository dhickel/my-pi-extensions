"""The single bounded CLI report contract consumed by the later thin bridge."""
from __future__ import annotations

from .manifest import (array, boolean, closed, digest, identifier, integer,
                       json_bytes, relative_path, require, text)

REPORT_LIMIT = 256*1024
FIELDS = ("schema_version", "operation", "action", "status", "project_root", "manifest", "consumer", "id",
          "selected", "source_approval", "native_proof", "native_visual_approval", "tool_sha256", "counts",
          "artifacts", "owned_paths", "error", "summary", "process")
STATUSES = ("UNAPPROVED", "CANDIDATE", "CANDIDATE_TEST_ONLY", "COMPUTATIONAL_PASS_REVIEW_REQUIRED",
            "TEST_ONLY_COMPUTATIONAL_PASS_REVIEW_REQUIRED", "APPROVED", "PUBLISHED", "BLOCKED", "CANCELLED")


def bounded_report(operation, action, project_root, manifest, full, full_record, process):
    approval = full.get("source_approval")
    artifacts = [{"kind": "full-report", **full_record}] if full_record else []
    for key in ("packet", "output_inventory", "provenance", "seal", "review_inventory", "review_draft", "computational", "receipt", "selector"):
        row = full.get(key)
        if isinstance(row, dict) and "path" in row and "sha256" in row:
            artifacts.append({"kind": key.replace("_", "-"), "path": row["path"], "sha256": row["sha256"]})
    # An immutable full report carries unbounded original/output/case inventories;
    # the public response carries only content-bound paths and genuine counts.
    artifacts = [{k: row[k] for k in ("kind", "path", "sha256")} for row in artifacts]
    report = {"schema_version": 2, "operation": operation, "action": action, "status": full["status"],
              "project_root": project_root[:4096] if isinstance(project_root, str) else None,
              "manifest": manifest[:4096] if isinstance(manifest, str) else None, "consumer": full.get("consumer"), "id": full.get("id"),
              "selected": full.get("selected", False),
              "source_approval": {k: approval[k] for k in ("path", "sha256", "test_only", "actual_visual_approval")} if approval else None,
              "native_proof": full.get("native_proof", False), "native_visual_approval": full.get("native_visual_approval", False),
              "tool_sha256": full.get("tool_sha256"), "counts": full.get("counts", {}), "artifacts": artifacts,
              "owned_paths": full.get("owned_paths", []), "error": full.get("error"),
              "summary": full["status"]+"; "+("exact immutable bundle selected" if full.get("selected") else "no output selected"),
              "process": process}
    check_report(report)
    require(len(json_bytes(report)) <= REPORT_LIMIT, "CLI report exceeds 256KiB")
    return report


def check_report(report):
    closed(report, FIELDS, "bounded CLI report v2")
    require(type(report["schema_version"]) is int and report["schema_version"] == 2, "Wrong CLI report version")
    failed = report["status"] in ("BLOCKED", "CANCELLED")
    actions = {"inspect": ("inspect",), "build": ("candidate", "publish"), "render": ("render",), "validate": ("validate",)}
    require(report["status"] in STATUSES and (report["operation"] in actions and report["action"] in actions[report["operation"]]
            or failed and report["operation"] is None and report["action"] is None), "Wrong CLI operation/action/status")
    required = {"UNAPPROVED": ("inspect", "inspect"), "CANDIDATE": ("build", "candidate"), "CANDIDATE_TEST_ONLY": ("build", "candidate"),
                "COMPUTATIONAL_PASS_REVIEW_REQUIRED": ("render", "render"), "TEST_ONLY_COMPUTATIONAL_PASS_REVIEW_REQUIRED": ("render", "render"),
                "APPROVED": ("validate", "validate"), "PUBLISHED": ("build", "publish")}
    require(failed or (report["operation"], report["action"]) == required[report["status"]], "Contradictory CLI status/action")
    for key in ("project_root", "manifest"):
        if report[key] is not None:
            text(report[key], "explicit requested " + key)
        require(failed or report[key] is not None, "Successful CLI requires explicit root/manifest")
    if not failed:
        require(report["project_root"].startswith("/"), "Successful CLI requires absolute consumer root")
        relative_path(report["manifest"])
    for key in ("consumer", "id"):
        if report[key] is not None:
            identifier(report[key], key)
    for key in ("selected", "native_proof", "native_visual_approval"):
        boolean(report[key], key)
    require(report["selected"] == (report["status"] == "PUBLISHED"), "Fake selected CLI success")
    require(report["native_visual_approval"] == (report["status"] in ("APPROVED", "PUBLISHED")), "Computation is not visual approval")
    require(report["native_proof"] == (report["status"] in ("COMPUTATIONAL_PASS_REVIEW_REQUIRED", "TEST_ONLY_COMPUTATIONAL_PASS_REVIEW_REQUIRED", "APPROVED", "PUBLISHED")),
            "Contradictory CLI native proof")
    require(failed or report["consumer"] is not None and report["id"] is not None and report["tool_sha256"] is not None,
            "Successful CLI requires bound consumer/item/tool")
    require(report["status"] == "UNAPPROVED" or failed or report["source_approval"] is not None, "Successful guarded CLI requires source approval")
    if report["source_approval"] is not None:
        approval = closed(report["source_approval"], ("path", "sha256", "test_only", "actual_visual_approval"), "bounded source approval")
        relative_path(approval["path"])
        digest(approval["sha256"])
        boolean(approval["test_only"], "source test-only")
        boolean(approval["actual_visual_approval"], "source actual approval")
        require(approval["test_only"] != approval["actual_visual_approval"], "Ambiguous source trust")
        require(not report["native_visual_approval"] or not approval["test_only"], "TEST-ONLY cannot claim native visual approval")
        if report["status"] in ("CANDIDATE", "COMPUTATIONAL_PASS_REVIEW_REQUIRED", "APPROVED", "PUBLISHED"):
            require(approval["actual_visual_approval"], "Production CLI requires actual source review")
        if report["status"] in ("CANDIDATE_TEST_ONLY", "TEST_ONLY_COMPUTATIONAL_PASS_REVIEW_REQUIRED"):
            require(approval["test_only"], "TEST-ONLY status requires explicit source test trust")
    if report["tool_sha256"] is not None:
        digest(report["tool_sha256"])
    require(type(report["counts"]) is dict and len(report["counts"]) <= 128, "Bounded genuine CLI counts")
    for key, value in report["counts"].items():
        text(key, "count name")
        integer(value, key)
    require(len(array(report["artifacts"], "bounded artifact references")) <= 128, "Too many CLI artifact references")
    for row in report["artifacts"]:
        closed(row, ("kind", "path", "sha256"), "CLI artifact reference")
        text(row["kind"], "artifact kind")
        relative_path(row["path"])
        digest(row["sha256"])
    require(len(array(report["owned_paths"], "bounded owned paths")) <= 128, "Too many CLI owned paths")
    for path in report["owned_paths"]:
        relative_path(path)
    if report["error"] is not None:
        require(type(report["error"]) is str and len(report["error"]) <= 8192, "Oversized CLI error")
    require(len(text(report["summary"], "bounded summary")) <= 16384, "Oversized model summary")
    if report["process"] is not None:
        closed(report["process"], ("pid", "pgid"), "invocation ownership")
        integer(report["process"]["pid"], "owned PID", 1)
        integer(report["process"]["pgid"], "owned PGID", 1)
        require(report["process"]["pgid"] == report["process"]["pid"], "Unsafe invocation PGID")
    return report
