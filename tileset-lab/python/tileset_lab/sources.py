"""Closed original inventories, immutable source snapshots, UNAPPROVED art packets."""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
import sys

import numpy as np
import PIL
from PIL import Image, ImageDraw

from .manifest import (array, closed, digest, identifier, integer, json_bytes, overlaps,
                       pair, relative_path, require, sha256, text, unique)
from .pixels import compare_visible, premultiply, source_over, unpremultiply, visible_digest
from .terrain import ROLE_ORDER, load_catalog, source_tile


def png_bytes(image):
    stream = BytesIO()
    image.save(stream, format="PNG", compress_level=9)
    return stream.getvalue()


def image_bytes(content, label):
    try:
        with Image.open(BytesIO(content)) as opened:
            require(opened.format == "PNG", f"{label}: expected original PNG")
            opened.load()
            return opened.convert("RGBA")
    except (OSError, ValueError) as error:
        raise ValueError(f"{label}: unreadable PNG: {error}") from error


def tool_identity():
    """Relocation-independent code and actual imported dependency content identities."""
    folder = Path(__file__).parent
    files = {p.relative_to(folder).as_posix(): sha256(p.read_bytes())
             for p in sorted(folder.rglob("*")) if p.is_file() and p.suffix in (".py", ".js")}
    files["requirements.txt"] = sha256((folder.parent / "requirements.txt").read_bytes())
    pillow_dir, numpy_dir = Path(PIL.__file__).parent, Path(np.__file__).parent
    pillow_files = [p for p in pillow_dir.rglob("*") if p.suffix in (".py", ".so")]
    numpy_files = [p for p in numpy_dir.rglob("*") if p.suffix in (".py", ".so")]
    dependencies = {}
    for name, version, directory, paths in (("Pillow", PIL.__version__, pillow_dir, pillow_files),
                                             ("NumPy", np.__version__, numpy_dir, numpy_files)):
        hashes = {p.relative_to(directory).as_posix(): sha256(p.read_bytes()) for p in sorted(paths)}
        dependencies[name] = {"version": version, "files": hashes, "sha256": sha256(json_bytes(hashes))}
    identity = {"files": files, "dependencies": dependencies}
    return {"sha256": sha256(json_bytes(identity)), **identity}


def capabilities(manifest):
    return {key: {"path": manifest[key], "resolved_path": str(Path(manifest[key]).resolve()),
                  "sha256": sha256(Path(manifest[key]).read_bytes())}
            for key in ("python_executable", "tiled_runtime")}


def current_inventory(inputs, manifest):
    declared = {entry["path"]: entry["license"] for entry in manifest["originals"]}
    actual = {value for scope in manifest["source_roots"] for value in inputs.root.files(scope)}
    missing, unexpected = sorted(set(declared) - actual), sorted(actual - set(declared))
    require(not missing and not unexpected,
            f"Closed original scope mismatch: missing={missing}, unexpected={unexpected}; no rebaseline")
    files = []
    for path in sorted(declared):
        content = inputs.read(path)
        size = list(image_bytes(content, path).size) if path.lower().endswith(".png") else None
        files.append({"path": path, "size_bytes": len(content), "sha256": sha256(content),
                      "png_size": size, "license": declared[path]})
    return {"schema_version": 1, "consumer": manifest["id"], "hash_algorithm": "sha256", "files": files}


def validate_inventory(inputs, manifest, *, initialize=False):
    current = current_inventory(inputs, manifest)
    path = manifest["inventory"]
    if not inputs.root.exists(path):
        require(initialize, "Missing source inventory; inspect --initialize-inventory is an explicit authoring action")
        inputs.root.write(path, json_bytes(current))
    saved = closed(inputs.json(path), ("schema_version", "consumer", "hash_algorithm", "files"), "source inventory")
    require(type(saved["schema_version"]) is int and saved["schema_version"] == 1
            and saved["consumer"] == manifest["id"] and saved["hash_algorithm"] == "sha256", "Inventory header mismatch")
    for row in array(saved["files"], "inventory files", True):
        closed(row, ("path", "size_bytes", "sha256", "png_size", "license"), "inventory file")
        relative_path(row["path"])
        integer(row["size_bytes"], "inventory byte size")
        digest(row["sha256"])
        if row["png_size"] is not None:
            pair(row["png_size"], "PNG dimensions", 1)
        text(row["license"], "inventory license")
    unique([row["path"] for row in saved["files"]], "inventory paths")
    if saved != current:
        a, b = {r["path"]: r for r in saved["files"]}, {r["path"]: r for r in current["files"]}
        changed = sorted(p for p in set(a) & set(b) if a[p] != b[p])
        require(False, f"Original inventory mismatch: missing={sorted(set(a)-set(b))}, "
                f"unexpected={sorted(set(b)-set(a))}, changed={changed}; refusing rebaseline")
    licenses = {entry["id"]: entry for entry in manifest["licenses"]}
    by_path = {row["path"]: row for row in saved["files"]}
    for license in licenses.values():
        require(by_path[license["path"]]["license"] == license["id"], "License file association mismatch")
        require(bool(inputs.read(license["path"]).strip()), "Empty original license record")
    return saved


def load_sources(inputs, manifest):
    result = {}
    for spec in manifest["sources"]:
        image = image_bytes(inputs.read(spec["path"]), spec["path"])
        width, height = spec["frame_size"]
        require(image.width % width == image.height % height == 0, "Non-integral complete frame grid")
        grid = {(x, y, width, height) for y in range(0, image.height, height)
                for x in range(0, image.width, width)}
        require({tuple(s["rect"]) for s in spec["slots"]} == grid,
                f"{spec['id']}: source slot inventory must cover the complete declared frame grid")
        bounds = {}
        for slot in spec["slots"]:
            x, y, w, h = slot["rect"]
            frame = image.crop((x, y, x+w, y+h))
            bbox = frame.getchannel("A").getbbox()
            require((bbox is None) == slot["empty"], f"{spec['id']}/{slot['id']}: dishonest empty slot")
            bounds[slot["id"]] = list(bbox) if bbox else None
        require(any(bounds.values()), f"{spec['id']}: entirely empty source")
        result[spec["id"]] = {**spec, "image": image, "sha256": sha256(inputs.read(spec["path"])),
                               "alpha_bboxes": bounds}
    return result


def load_catalogs(inputs, manifest, sources):
    return {pack["id"]: load_catalog(inputs.json(pack["catalog"]), pack["id"], sources, manifest["cell_size"])
            for pack in manifest["packs"]}


def load_frozen(inputs, manifest, catalogs, sources):
    doc = closed(inputs.json(manifest["frozen_reference"]), ("schema_version", "author_id", "families"), "frozen references")
    require(type(doc["schema_version"]) is int and doc["schema_version"] == 1, "Unsupported frozen reference version")
    text(doc["author_id"], "source author identity")
    expected = {(pack, f["id"]): f for pack, cat in catalogs.items() for f in cat["families"]}
    entries = {}
    image_paths = []
    protected = [manifest["inventory"], manifest["frozen_reference"], manifest["source_review"], manifest["scenes"],
                 *manifest["source_roots"], *(p["catalog"] for p in manifest["packs"])]
    for entry in array(doc["families"], "frozen families", True):
        closed(entry, ("pack", "family", "source", "cell_size", "foreground", "background", "mode", "roles"), "frozen family")
        key = (entry["pack"], entry["family"])
        require(key in expected and key not in entries, "Missing/duplicate/unknown frozen family")
        family = expected[key]
        require(type(entry["cell_size"]) is int and entry["cell_size"] == manifest["cell_size"], "Frozen geometry mismatch")
        require(all(entry[k] == family[k] for k in ("source", "foreground", "background", "mode")), "Frozen materials/source mismatch")
        rows = array(entry["roles"], "frozen roles", True)
        require(len(rows) == 14, "Partial frozen source role coverage")
        seen = []
        for row in rows:
            closed(row, ("role", "coordinate", "image", "source_sha256", "image_sha256", "visible_rgba_sha256"), "frozen role")
            require(row["role"] in ROLE_ORDER, "Unknown frozen source role")
            seen.append(row["role"])
            pair(row["coordinate"], "independent frozen coordinate")
            relative_path(row["image"])
            require(not any(overlaps(row["image"], p) for p in [manifest["output_root"], *protected]),
                    "Frozen art/output/protected-input alias")
            image_paths.append(row["image"])
            for k in ("source_sha256", "image_sha256", "visible_rgba_sha256"):
                digest(row[k], k)
            source = sources[family["source"]]
            require(source["sha256"] == row["source_sha256"], "Frozen original source hash drift")
            content = inputs.read(row["image"])
            require(sha256(content) == row["image_sha256"], "Frozen original artwork changed; no refresh allowed")
            frozen = image_bytes(content, row["image"])
            require(frozen.size == (manifest["cell_size"],) * 2, "Frozen role must be a complete original cell")
            require(visible_digest(frozen) == row["visible_rgba_sha256"], "Frozen visible RGBA hash drift")
            compare_visible(frozen, source_tile(source["image"], row["coordinate"], manifest["cell_size"]),
                            f"{key}/{row['role']}: independent frozen/source correspondence")
        unique(seen, "frozen role coverage")
        require(set(seen) == set(ROLE_ORDER), "Incomplete frozen source roles")
        entries[key] = entry
    require(set(entries) == set(expected), "Incomplete independent frozen family inventory")
    unique(image_paths, "frozen image paths")
    return doc, entries


def checker(size):
    image = Image.new("RGBA", size, (73, 87, 99, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], 8):
        for x in range(0, size[0], 8):
            if (x//8 + y//8) % 2:
                draw.rectangle((x, y, x+7, y+7), fill=(49, 62, 73, 255))
    return image


def context_image(image, ground=False):
    base = Image.new("RGBA", image.size, (89, 104, 69, 255)) if ground else checker(image.size)
    return unpremultiply(source_over(premultiply(base), premultiply(image)))


def role_page(family, source, frozen_rows, inputs, size):
    zoom = 3
    edge = size * zoom
    panel_w, panel_h = 2 * edge + 28, 2 * edge + 84
    page = Image.new("RGBA", (7 * panel_w, 2 * panel_h + 54), (24, 31, 38, 255))
    draw = ImageDraw.Draw(page)
    draw.text((12, 8), f"UNAPPROVED / {family['name']} / {family['mode']}", fill="white")
    draw.text((12, 28), "Original candidate | independent frozen. Checker above; ground below. No art verdict.", fill="white")
    rows = {r["role"]: r for r in frozen_rows}
    for index, role in enumerate(ROLE_ORDER):
        x, y = index % 7 * panel_w, index // 7 * panel_h + 54
        draw.text((x+8, y+4), role, fill="white")
        draw.text((x+8, y+20), f"cell {family['roles'][role]} / frozen {rows[role]['coordinate']}", fill="white")
        original = source_tile(source, family["roles"][role], size)
        frozen = image_bytes(inputs.read(rows[role]["image"]), role)
        for column, image in enumerate((original, frozen)):
            for row, ground in enumerate((False, True)):
                painted = context_image(image, ground).resize((edge, edge), Image.Resampling.NEAREST)
                page.paste(painted, (x+8+column*(edge+8), y+44+row*(edge+8)))
    require(max(page.size) <= 2000, "Source page exceeded 2000px")
    return page


def inspect_sources(inputs, manifest, manifest_path, inspection_id, *, initialize=False):
    identifier(inspection_id, "inspection id")
    created_inventory = not inputs.root.exists(manifest["inventory"])
    inventory = validate_inventory(inputs, manifest, initialize=initialize)
    sources = load_sources(inputs, manifest)
    catalogs = load_catalogs(inputs, manifest, sources)
    frozen_doc, frozen = load_frozen(inputs, manifest, catalogs, sources)
    identity, runtime = tool_identity(), capabilities(manifest)
    directory = f"{manifest['output_root']}/inspections/{inspection_id}"
    inputs.root.mkdir(directory)
    inputs.root.write(f"{directory}/owner.json", json_bytes({"schema_version": 1, "consumer": manifest["id"],
                      "operation": "inspect", "id": inspection_id, "producer": frozen_doc["author_id"]}))
    full_sources = {}
    for source in sources.values():
        path = f"{directory}/full/{source['id']}.png"
        content = inputs.read(source["path"])
        inputs.root.write(path, content)
        full_sources[source["id"]] = {"source": source["id"], "original": source["path"], "path": path,
                                     "sha256": sha256(content), "dimensions": list(source["image"].size)}
    role_entries, pages = [], []
    for pack, catalog in catalogs.items():
        catalog_path = next(p["catalog"] for p in manifest["packs"] if p["id"] == pack)
        for family in catalog["families"]:
            oracle = frozen[(pack, family["id"])]
            source = sources[family["source"]]
            page = role_page(family, source["image"], oracle["roles"], inputs, manifest["cell_size"])
            page_path = f"{directory}/pages/{pack}-{family['id']}.png"
            content = png_bytes(page)
            inputs.root.write(page_path, content)
            page_info = {"path": page_path, "sha256": sha256(content), "dimensions": list(page.size)}
            pages.append(page_info)
            rows = {r["role"]: r for r in oracle["roles"]}
            for role in ROLE_ORDER:
                tile = source_tile(source["image"], family["roles"][role], manifest["cell_size"])
                crop_path = f"{directory}/roles/{pack}-{family['id']}/{role}.png"
                crop = png_bytes(tile)
                inputs.root.write(crop_path, crop)
                frozen_path = f"{directory}/frozen-candidates/{pack}-{family['id']}/{role}.png"
                frozen_bytes = inputs.read(rows[role]["image"])
                inputs.root.write(frozen_path, frozen_bytes)
                role_entries.append({"pack": pack, "family": family["id"], "role": role,
                    "source": source["id"], "source_path": source["path"], "source_sha256": source["sha256"],
                    "catalog_path": catalog_path, "catalog_sha256": sha256(inputs.read(catalog_path)),
                    "coordinate": family["roles"][role], "frozen_coordinate": rows[role]["coordinate"],
                    "foreground": family["foreground"], "background": family["background"], "mode": family["mode"],
                    "candidate": {"path": crop_path, "sha256": sha256(crop), "visible_rgba_sha256": visible_digest(tile)},
                    "frozen": {"path": rows[role]["image"], "sha256": rows[role]["image_sha256"],
                               "visible_rgba_sha256": rows[role]["visible_rgba_sha256"]},
                    "frozen_candidate": {"path": frozen_path, "sha256": sha256(frozen_bytes)},
                    "full_source": full_sources[source["id"]], "page": page_info,
                    "visible_pixels_equal": visible_digest(tile) == rows[role]["visible_rgba_sha256"]})
    packet = {"schema_version": 1, "status": "UNAPPROVED", "consumer": manifest["id"],
              "profile": manifest["profile"], "cell_size": manifest["cell_size"], "tool": identity,
              "capabilities": runtime, "author_id": frozen_doc["author_id"],
              "inputs": {"manifest_path": manifest_path, "manifest_sha256": sha256(inputs.read(manifest_path)),
                         "inventory_path": manifest["inventory"], "inventory_sha256": sha256(inputs.read(manifest["inventory"])),
                         "frozen_reference_path": manifest["frozen_reference"],
                         "frozen_reference_sha256": sha256(inputs.read(manifest["frozen_reference"])),
                         "licenses": [{**record, "sha256": sha256(inputs.read(record["path"]))} for record in manifest["licenses"]]},
              "source_images": list(full_sources.values()), "roles": role_entries, "pages": pages}
    packet_path = f"{directory}/packet.json"
    inputs.root.write(packet_path, json_bytes(packet))
    inputs.recheck()
    from .manifest import Inputs
    require(current_inventory(Inputs(inputs.root), manifest) == inventory, "Source scope changed during inspect")
    require(tool_identity() == identity and capabilities(manifest) == runtime, "Tool/capability changed during inspect")
    report = {"schema_version": 1, "operation": "inspect", "status": "UNAPPROVED", "consumer": manifest["id"],
              "id": inspection_id, "packet": {"path": packet_path, "sha256": sha256(json_bytes(packet))},
              "tool_sha256": identity["sha256"], "input_hashes": inputs.hashes(),
              "counts": {"originals": len(inventory["files"]), "sources": len(sources), "families": len(frozen),
                         "roles": len(role_entries), "pages": len(pages)},
              "owned_paths": inputs.root.owned_paths(directory) + ([manifest["inventory"]] if created_inventory else []),
              "source_visual_approval": False}
    files = inputs.root.files(directory)
    output_inventory = [{"path": path, "size_bytes": len(inputs.root.read(path)[0]),
                         "sha256": sha256(inputs.root.read(path)[0])} for path in files]
    inv_path = f"{directory}/output-inventory.json"
    inputs.root.write(inv_path, json_bytes({"schema_version": 1, "files": output_inventory}))
    report["output_inventory"] = {"path": inv_path, "sha256": sha256(json_bytes({"schema_version": 1, "files": output_inventory}))}
    inputs.root.write(f"{directory}/report.json", json_bytes(report))
    return report
