"""Explicit consumer CLI: inspect, build candidate OR publish, render, validate.

Stdout is one bounded v2 JSON report (except explicit --help). Complete reports,
inventories and native logs are owned artifacts. No descendant precedes the
private readiness/release handshake; no selection precedes current proof.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET


def arguments(argv):
    from .manifest import Blocked
    class Parser(argparse.ArgumentParser):
        def error(self, message):
            raise Blocked("CLI arguments: " + message)
    parser = Parser(description="Tileset Lab quarter-corner-v1; computational proof and independent visual approval are separate gates.")
    commands = parser.add_subparsers(dest="operation", required=True)
    for operation in ("inspect", "build", "render", "validate"):
        command = commands.add_parser(operation)
        command.add_argument("--project-root", required=True, help="Explicit absolute canonical no-symlink consumer root")
        command.add_argument("--manifest", required=True, help="Canonical consumer-relative closed manifest")
        if operation == "inspect":
            command.add_argument("--inspection-id", required=True, help="New exclusive UNAPPROVED packet identity")
            command.add_argument("--initialize-inventory", action="store_true", help="Exclusive initial original snapshot only; never refresh")
        elif operation == "build":
            choice = command.add_mutually_exclusive_group(required=True)
            choice.add_argument("--candidate-id", help="New stable unselected source-guarded candidate")
            choice.add_argument("--publish-candidate", help="Select this EXACT already-frozen candidate; never rebuild")
            command.add_argument("--receipt", help="Required with publication: consumer-relative APPROVED receipt")
            command.add_argument("--test-trust", action="store_true", help="Explicit TEST-ONLY source parser/development trust; forbidden for publication")
        else:
            command.add_argument("--candidate-id", required=True, help="Existing stable source-bound candidate")
            command.add_argument("--test-trust", action="store_true", help="Explicit TEST-ONLY development proof, never actual source/native visual approval")
            if operation == "validate":
                command.add_argument("--review", required=True, help="OTHER reviewer's current complete consumer-relative native visual record")
                command.add_argument("--receipt-id", required=True, help="New exclusive receipt identity; only actual source/native approval admits it")
    return parser.parse_args(argv)


def main(argv=None):
    sys.dont_write_bytecode = True
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    # Bootstrap/failure serialization deliberately imports no Pillow/NumPy.
    from .manifest import Inputs, Root, json_bytes, load_manifest, require
    from .native import complete_delivery, invocation_group, owned_settlement, settle_owned
    from .report import bounded_report
    errors = (ImportError, ValueError, OSError, KeyError, TypeError, OverflowError,
              ET.ParseError, subprocess.SubprocessError, KeyboardInterrupt)
    values = list(sys.argv[1:] if argv is None else argv)
    operation = values[0] if values and values[0] in ("inspect", "build", "render", "validate") else None
    action = ("publish" if "--publish-candidate" in values else "candidate") if operation == "build" else operation
    args, root, manifest, invocation, full_record, process = None, None, None, None, None, None
    exit_code, emitted = 0, False
    try:
        with invocation_group() as process:
            args = arguments(values)
            operation = args.operation
            require(sys.version_info >= (3, 12), "BLOCKED prerequisite: Python >=3.12")
            import PIL
            import numpy as np
            require(tuple(int(x) for x in PIL.__version__.split(".")[:2]) >= (10, 1)
                    and tuple(int(x) for x in np.__version__.split(".")[:2]) >= (1, 26),
                    "BLOCKED prerequisite: Pillow >=10.1 and NumPy >=1.26; no installation")
            from .review import file_record
            root = Root(args.project_root)
            with root.lock(), owned_settlement():
                inputs = Inputs(root)
                manifest = load_manifest(inputs, args.manifest)
                require(Path(sys.executable).resolve() == Path(manifest["python_executable"]).resolve(), "Invoke manifest's explicit Python executable")
                invocation = f"{manifest['output_root']}/invocations/{uuid.uuid4().hex}"
                root.mkdir(invocation)
                root.write(f"{invocation}/owner.json", json_bytes({"schema_version": 1, "consumer": manifest["id"], "operation": operation, "action": action, "process": process}))

                def prepare_report(value):
                    nonlocal full_record
                    # Publication calls this INSIDE its ownership/rollback guard.
                    # Settle descendants while still holding the whole-root lock.
                    settle_owned()
                    inputs.recheck()
                    path = f"{invocation}/report.json"
                    if root.exists(path):
                        path = f"{invocation}/failure-report.json"
                    root.write(path, json_bytes(value))
                    full_record = file_record(root, path)
                    return bounded_report(operation, action, args.project_root, args.manifest, value, full_record, process)

                def deliver_report(public):
                    nonlocal emitted
                    content = json_bytes(public)
                    root.check_root()
                    def delivery():
                        nonlocal emitted
                        sys.stdout.buffer.write(content)
                        sys.stdout.buffer.flush()
                        emitted = True
                        root._lock_complete = True
                    complete_delivery(delivery)

                def finish_report(value):
                    deliver_report(prepare_report(value))

                stage_directory, stage_existed = None, True
                try:
                    if operation == "inspect":
                        stage_directory = f"{manifest['output_root']}/inspections/{args.inspection_id}"
                    elif operation == "build" and not args.publish_candidate:
                        stage_directory = f"{manifest['output_root']}/candidates/{args.candidate_id}"
                    elif operation == "render":
                        stage_directory = f"{manifest['output_root']}/candidates/{args.candidate_id}/native"
                    if stage_directory:
                        stage_existed = root.exists(stage_directory)
                    if operation == "inspect":
                        from .sources import inspect_sources
                        full = inspect_sources(inputs, manifest, args.manifest, args.inspection_id, initialize=args.initialize_inventory)
                    elif operation == "build":
                        if args.publish_candidate:
                            require(args.receipt and not args.test_trust, "Publication requires --receipt and forbids --test-trust")
                            from .review import publish_candidate
                            full = publish_candidate(inputs, manifest, args.manifest, args.publish_candidate, args.receipt,
                                                     finalize=prepare_report, deliver=deliver_report)
                        else:
                            require(args.receipt is None, "Candidate build and publication receipt are mutually exclusive")
                            from .maps import build_candidate
                            full = build_candidate(inputs, manifest, args.manifest, args.candidate_id, allow_test_trust=args.test_trust)
                    elif operation == "render":
                        from .native import render_candidate
                        full = render_candidate(inputs, manifest, args.manifest, args.candidate_id, allow_test_trust=args.test_trust)
                    else:
                        from .validate import validate_candidate
                        full = validate_candidate(inputs, manifest, args.manifest, args.candidate_id, args.review, args.receipt_id, allow_test_trust=args.test_trust)
                except errors as error:
                    exit_code = 130 if isinstance(error, KeyboardInterrupt) else 2
                    full = {"schema_version": 1, "operation": operation, "status": "CANCELLED" if isinstance(error, KeyboardInterrupt) else "BLOCKED",
                            "consumer": manifest["id"], "id": None, "selected": False, "error": str(error)[:8192], "owned_paths": [invocation]}
                    if stage_directory and not stage_existed and root.exists(f"{stage_directory}/owner.json"):
                        try:
                            from .manifest import parse_json
                            owner = parse_json(root.read(f"{stage_directory}/owner.json")[0], "failed staging owner")
                            require(type(owner) is dict, "Failed staging owner must be a JSON object")
                            require(owner.get("consumer") == manifest["id"] and owner.get("operation") == operation, "Failed staging ownership uncertain")
                            full["owned_paths"].append(stage_directory)
                        except (ValueError, OSError):
                            full["ownership_warning"] = "Failed stage ownership uncertain; no cleanup performed"
                if not emitted:
                    finish_report(full)
    except errors as error:
        exit_code = 130 if isinstance(error, KeyboardInterrupt) else 2
        full = {"status": "CANCELLED" if isinstance(error, KeyboardInterrupt) else "BLOCKED", "selected": False,
                "error": str(error)[:8192], "owned_paths": [invocation] if invocation else []}
        report = bounded_report(operation, action, args.project_root if args else None, args.manifest if args else None, full, full_record, process)
    finally:
        if root is not None:
            root.close()
    if not emitted:
        sys.stdout.buffer.write(json_bytes(report))
        sys.stdout.buffer.flush()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
