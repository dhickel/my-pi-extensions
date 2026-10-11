"""Only real Phase 01 operations: inspect and source-guarded candidate build."""
from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET


def main(argv=None):
    parser = argparse.ArgumentParser(description="Portable quarter-corner-v1 tilesets; no native/publication claims.")
    commands = parser.add_subparsers(dest="operation", required=True)
    for operation in ("inspect", "build"):
        command = commands.add_parser(operation)
        command.add_argument("--project-root", required=True, help="Explicit absolute, no-symlink consumer root")
        command.add_argument("--manifest", required=True, help="Canonical consumer-relative manifest path")
        if operation == "inspect":
            command.add_argument("--inspection-id", required=True, help="New immutable UNAPPROVED packet identifier")
            command.add_argument("--initialize-inventory", action="store_true", help="Explicit exclusive original snapshot; never refresh an existing inventory")
        else:
            command.add_argument("--candidate-id", required=True, help="New stable, unselected candidate identifier")
            command.add_argument("--test-trust", action="store_true", help="Admit explicitly TEST-ONLY records through the production guard; never certifies art")
    args = parser.parse_args(argv)
    root, doc, directory, existed = None, None, None, True
    try:
        if sys.version_info < (3, 12):
            raise ValueError("BLOCKED prerequisite: Python >=3.12")
        import PIL
        import numpy as np
        if tuple(int(x) for x in PIL.__version__.split(".")[:2]) < (10, 1) or tuple(int(x) for x in np.__version__.split(".")[:2]) < (1, 26):
            raise ValueError("BLOCKED prerequisite: Pillow >=10.1 and NumPy >=1.26; no automatic installation")
        from pathlib import Path
        from .manifest import Blocked, Inputs, Root, identifier, json_bytes, load_manifest, require
        from .maps import build_candidate
        from .sources import inspect_sources
        root = Root(args.project_root)
        with root.lock():
            inputs = Inputs(root)
            doc = load_manifest(inputs, args.manifest)
            require(Path(sys.executable).resolve() == Path(doc["python_executable"]).resolve(),
                    "Invoke the manifest's explicit Python executable")
            identity = args.inspection_id if args.operation == "inspect" else args.candidate_id
            identifier(identity)
            namespace = "inspections" if args.operation == "inspect" else "candidates"
            directory = f"{doc['output_root']}/{namespace}/{identity}"
            existed = root.exists(directory)
            if args.operation == "inspect":
                report = inspect_sources(inputs, doc, args.manifest, identity, initialize=args.initialize_inventory)
            else:
                report = build_candidate(inputs, doc, args.manifest, identity, allow_test_trust=args.test_trust)
            encoded = json_bytes(report)
            require(len(encoded) <= 256*1024, "Operation report exceeds 256KiB; full artifacts remain unselected")
        sys.stdout.buffer.write(encoded)
        return 0
    except (ImportError, ValueError, OSError, KeyError, TypeError, OverflowError, ET.ParseError, KeyboardInterrupt) as error:
        status = "CANCELLED" if isinstance(error, KeyboardInterrupt) else "BLOCKED"
        report = {"schema_version": 1, "operation": args.operation, "status": status,
                  "project_root": args.project_root, "selected": False, "error": str(error)[:8192], "owned_paths": []}
        # Failed new runs retain only their own evidence; never write into an existing candidate.
        if root is not None and doc is not None and directory and not existed:
            try:
                with root.lock():
                    owner_path = f"{directory}/owner.json"
                    owner = json.loads(root.read(owner_path)[0])
                    if owner["consumer"] == doc["id"] and owner["operation"] == args.operation:
                        report["owned_paths"] = [directory]
                        root.write(f"{directory}/failure.json", (json.dumps(report, indent=2) + "\n").encode())
            except (ValueError, OSError, KeyError):
                report["ownership_warning"] = "Failed staging ownership could not be proven; no cleanup performed"
        sys.stdout.write(json.dumps(report, sort_keys=True, allow_nan=False) + "\n")
        return 2
    finally:
        if root is not None:
            root.close()


if __name__ == "__main__":
    raise SystemExit(main())
