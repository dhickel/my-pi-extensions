"""Phase 01 acceptance through real parsers/guards. No mocks or source-root imports."""
from __future__ import annotations

from copy import deepcopy
from itertools import product
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

from tileset_lab.manifest import (Blocked, Inputs, Root, json_bytes, load_manifest,
                                  parse_json, sha256)
from tileset_lab.maps import (build_candidate, map_evidence, parse_map, read_tileset,
                              render_graph, resolve_reference, visible_entities)
from tileset_lab.pixels import (animation_probes, byte_multiply, compare_premultiplied,
                                compare_visible, frame_index_at, premultiply, source_over,
                                unpremultiply, visible_digest, visible_rgba)
from tileset_lab.source_geometry import check_source_geometry
from tileset_lab.sources import (current_inventory, inspect_sources, load_catalogs, load_frozen,
                                 load_sources, tool_identity, validate_inventory)
from tileset_lab.terrain import (ROLE_ORDER, corner_id, field_masks, matching_masks, normalize,
                                 source_tile, validate_complete_rectangle)

PACKAGE = Path(__file__).resolve().parents[2]
FIXTURES = PACKAGE / "test/fixtures"


def read_json(path):
    return json.loads(path.read_bytes())


def set_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json_bytes(value))


def copy_fixture(destination, size):
    name = "saltworks-16" if size == 16 else "orchard-32"
    shutil.copytree(FIXTURES / name, destination)
    doc = read_json(destination / "manifest.json")
    doc["python_executable"] = sys.executable
    set_json(destination / "manifest.json", doc)
    old = destination / "outputs/previous-approved"
    old.mkdir(parents=True)
    (old / "art.bin").write_bytes(b"previous approved artwork must survive\x00\xff")
    set_json(destination / "outputs/approved-selector.json", {"candidate": "previous-approved", "receipt": "old"})
    return destination


def trust_record(root_path, report):
    """Explicit synthetic trust only, accepted by the unmodified production guard.

    This does not claim image viewing. Actual image-capable review is performed by
    a different agent after this implementation, against separate UNAPPROVED packets.
    """
    packet = read_json(root_path / report["packet"]["path"])
    record = {"schema_version": 1, "consumer": packet["consumer"],
              "reviewer": {"id": "TEST-ONLY:unittest-parser", "kind": "TEST-ONLY",
                           "independent_of": packet["author_id"], "image_capable": True},
              "packet": report["packet"], "tool_sha256": packet["tool"]["sha256"], "verdict": "PASS",
              "entries": [{"binding": entry, "observations":
                           "TEST-ONLY synthetic parser/guard trust, not actual artwork viewing or certification.",
                           "verdict": "PASS"} for entry in packet["roles"]]}
    path = root_path / read_json(root_path / "manifest.json")["source_review"]
    set_json(path, record)
    return record


def inspect(path, id="initial", initialize=True):
    root = Root(path)
    try:
        with root.lock():
            inputs = Inputs(root)
            doc = load_manifest(inputs, "manifest.json")
            return inspect_sources(inputs, doc, "manifest.json", id, initialize=initialize)
    finally:
        root.close()


def build(path, id="candidate", test=True):
    root = Root(path)
    try:
        with root.lock():
            inputs = Inputs(root)
            doc = load_manifest(inputs, "manifest.json")
            return build_candidate(inputs, doc, "manifest.json", id, allow_test_trust=test)
    finally:
        root.close()


def guard(path, test=True):
    root = Root(path)
    try:
        inputs = Inputs(root)
        doc = load_manifest(inputs, "manifest.json")
        validate_inventory(inputs, doc)
        sources = load_sources(inputs, doc)
        catalogs = load_catalogs(inputs, doc, sources)
        frozen_doc, frozen = load_frozen(inputs, doc, catalogs, sources)
        return check_source_geometry(inputs, doc, "manifest.json", sources, catalogs, frozen_doc, frozen,
                                     allow_test_trust=test)
    finally:
        root.close()


def frozen_patterns(path, family):
    """Independent fixed corner table; no production normalization or provenance oracle."""
    oracle = read_json(path / "references/frozen.json")
    entry = next(f for f in oracle["families"] if f["family"] == family["id"])
    roles = {r["role"]: Image.open(path / r["image"]).convert("RGBA") for r in entry["roles"]}
    n = entry["cell_size"]
    h = n//2
    positions = ((0, 0), (h, 0), (h, h), (0, h))
    # (horizontal neighbor, vertical neighbor, diagonal, convex, V-boundary, H-boundary, concave)
    table = ((1, 3, 2, "convex-SE", "edge-E", "edge-S", "concave-SE"),
             (0, 2, 3, "convex-SW", "edge-W", "edge-S", "concave-SW"),
             (3, 1, 0, "convex-NW", "edge-W", "edge-N", "concave-NW"),
             (2, 0, 1, "convex-NE", "edge-E", "edge-N", "concave-NE"))
    result = {}
    for mask in range(16):
        if mask == 0 and family["mode"] == "alpha":
            continue
        if mask in (0, 15):
            result[mask] = roles["background" if mask == 0 else "solid"].copy()
            continue
        image = Image.new("RGBA", (n, n))
        for k, (across, vertical, diagonal, convex, v_edge, h_edge, concave) in enumerate(table):
            output_x, output_y = positions[k]
            if not (mask >> k) & 1:
                role, index = "background", (k+2) % 4
            elif (mask >> across) & 1 and (mask >> vertical) & 1:
                role = "solid" if (mask >> diagonal) & 1 else concave
                index = (k+2) % 4 if role == "solid" else k
            elif (mask >> across) & 1:
                role, index = h_edge, k
            elif (mask >> vertical) & 1:
                role, index = v_edge, k
            else:
                role, index = convex, k
            sx, sy = positions[index]
            image.paste(roles[role].crop((sx, sy, sx+h, sy+h)), (output_x, output_y))
        result[mask] = image
    return result


class FixtureBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="tileset-lab-acceptance-")
        cls.paths, cls.inspections, cls.reports = {}, {}, {}
        for size in (16, 32):
            path = copy_fixture(Path(cls.temp.name) / f"consumer-{size}", size)
            cls.paths[size] = path
            cls.inspections[size] = inspect(path)
            trust_record(path, cls.inspections[size])
            cls.reports[size] = build(path)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_real_guard_covers_56_roles_without_actual_visual_claim(self):
        total = 0
        for size, path in self.paths.items():
            approval = guard(path)
            total += approval["roles"]
            self.assertTrue(approval["test_only"])
            self.assertFalse(approval["actual_visual_approval"])
            self.assertEqual(self.reports[size]["status"], "CANDIDATE_TEST_ONLY")
            self.assertFalse(self.reports[size]["selected"])
        self.assertEqual(total, 56)

    def test_packets_original_full_art_roles_frozen_candidates_pages_and_hashes(self):
        for size, path in self.paths.items():
            report = self.inspections[size]
            packet = read_json(path / report["packet"]["path"])
            self.assertEqual(packet["status"], "UNAPPROVED")
            self.assertEqual(report["counts"], {"originals": 6, "sources": 3, "families": 2, "roles": 28, "pages": 2})
            self.assertEqual(sha256((path / report["packet"]["path"]).read_bytes()), report["packet"]["sha256"])
            for entry in packet["roles"]:
                self.assertTrue(entry["visible_pixels_equal"])
                for record in (entry["candidate"], entry["frozen"], entry["frozen_candidate"], entry["full_source"], entry["page"]):
                    self.assertEqual(sha256((path / record["path"]).read_bytes()), record["sha256"])
                with Image.open(path / entry["candidate"]["path"]) as crop:
                    self.assertEqual(crop.size, (size, size))
                with Image.open(path / entry["page"]["path"]) as image:
                    self.assertLessEqual(max(image.size), 2000)
            self.assertEqual({e["role"] for e in packet["roles"]}, set(ROLE_ORDER))

    def test_native_resolution_independent_authorship_and_shuffled_coordinates(self):
        p16, p32 = self.paths[16], self.paths[32]
        c16, c32 = read_json(p16 / "data/catalog.json"), read_json(p32 / "data/catalog.json")
        for a, b in zip(c16["families"], c32["families"]):
            self.assertNotEqual(a["roles"], b["roles"])
            self.assertNotEqual(a["foreground"], b["foreground"])
            if a["mode"] == "opaque":
                self.assertNotEqual(a["background"], b["background"])
            self.assertNotEqual(a["roles"], b["roles"])
        a = Image.open(p16 / "originals/terrain.png").convert("RGBA")
        b = Image.open(p32 / "originals/terrain.png").convert("RGBA")
        self.assertNotEqual(a.resize(b.size, Image.Resampling.NEAREST).tobytes(), b.tobytes())
        self.assertNotEqual(read_json(p16 / "data/scenes.json"), read_json(p32 / "data/scenes.json"))
        self.assertNotEqual(c16["components"], c32["components"])

    def test_all_16_masks_exact_frozen_pixels_and_no_source_pixel_changes(self):
        for size, path in self.paths.items():
            catalog = read_json(path / "data/catalog.json")
            with Image.open(path / "originals/terrain.png") as opened:
                source = opened.convert("RGBA")
            raw_before = source.tobytes()
            for family in catalog["families"]:
                candidates, traces = normalize(source, family, size)
                expected = frozen_patterns(path, family)
                self.assertEqual(set(candidates), set(expected))
                self.assertEqual(len(candidates), 16 if family["mode"] == "opaque" else 15)
                for mask, tile in candidates.items():
                    self.assertEqual(tile.tobytes(), expected[mask].tobytes(), (size, family["id"], mask))
                    traced = Image.new("RGBA", (size, size))
                    for step in traces[mask]:
                        x, y, w, h = step["source_rect"]
                        dx, dy, dw, dh = step["destination_rect"]
                        self.assertEqual((w, h), (dw, dh))
                        self.assertIn(w, (size//2, size))
                        traced.paste(source.crop((x, y, x+w, y+h)), (dx, dy))
                    self.assertEqual(traced.tobytes(), tile.tobytes())
                    self.assertTrue(tile.getchannel("A").getbbox())
                self.assertEqual(len(traces[15]), 1)
                self.assertEqual(candidates[15].tobytes(), source_tile(source, family["roles"]["solid"], size).tobytes())
                if family["mode"] == "opaque":
                    self.assertEqual(len(traces[0]), 1)
                else:
                    self.assertNotIn(0, candidates)
                    self.assertLess(np.count_nonzero(np.asarray(candidates[15])[:, :, 3]), size*size//2)
            self.assertEqual(source.tobytes(), raw_before)

    def test_wang_candidates_registry_background_null_and_disabled_transforms(self):
        for size, path in self.paths.items():
            root = Root(path)
            try:
                provenance = read_json(path / self.reports[size]["provenance"]["path"])
                for family in provenance["terrains"]:
                    node = ET.fromstring((path / family["tsx"]).read_bytes())
                    trans = node.find("transformations")
                    self.assertEqual([trans.get(k) for k in ("hflip", "vflip", "rotate")], ["0"]*3)
                    wang = node.find("wangsets/wangset")
                    masks = range(16) if family["mode"] == "opaque" else range(1, 16)
                    self.assertEqual(len(wang.findall("wangcolor")), 2 if family["mode"] == "opaque" else 1)
                    entries = wang.findall("wangtile")
                    self.assertEqual(len(entries), len(list(masks)))
                    self.assertEqual(len({e.get("tileid") for e in entries}), len(entries))
                    for mask in masks:
                        local = family["mask_ids"][str(mask)]
                        entry = next(e for e in entries if e.get("tileid") == str(local))
                        self.assertEqual(list(map(int, entry.get("wangid").split(","))), corner_id(mask, family["mode"]))
                        self.assertNotEqual(entry.get("wangid"), "0,0,0,0,0,0,0,0")
                    if family["mode"] == "alpha":
                        self.assertIsNone(family["mask_ids"]["0"])
                        self.assertEqual(xml_count := int(node.get("tilecount")), 15)
                        self.assertEqual(len(read_tileset(root, family["tsx"])["images"]), xml_count)
                    else:
                        self.assertEqual(family["mask_ids"]["0"], 0)
                for entry in provenance["maps"]:
                    if entry["kind"] != "terrain-pattern":
                        continue
                    graph = parse_map(root, entry["path"], size)
                    terrain_layer = graph["xml"].findall("layer")[-1]
                    gids = [int(v) for v in terrain_layer.find("data").text.replace("\n", "").split(",")]
                    masks = [m for row in field_masks(entry["intent_vertices"]) for m in row]
                    mode = next(p.get("value") for p in terrain_layer.findall("properties/property") if p.get("name") == "mode")
                    self.assertEqual([i for i, g in enumerate(gids) if g == 0], [i for i, m in enumerate(masks) if m == 0] if mode == "alpha" else [])
            finally:
                root.close()

    def test_entire_inventory_complete_frames_aliases_and_ordered_timing(self):
        geometries = set()
        for size, path in self.paths.items():
            provenance = read_json(path / self.reports[size]["provenance"]["path"])
            root = Root(path)
            try:
                for source in provenance["sources"]:
                    asset = read_tileset(root, source["tsx"])
                    with Image.open(path / source["path"]) as opened:
                        image = opened.convert("RGBA")
                    usable = {s["id"]: s for s in source["slots"] if not s["empty"]}
                    if source["kind"] == "sprite":
                        geometries.add(tuple(source["frame_size"]))
                        self.assertEqual(len([s for s in source["slots"] if s["empty"]]), 2)
                        self.assertEqual(len(asset["images"]), len(usable)+len(source["aliases"])+len(source["animations"]))
                        self.assertTrue(all(s["usable_tile_id"] is None for s in source["slots"] if s["empty"]))
                    for slot in usable.values():
                        x, y, w, h = slot["rect"]
                        self.assertEqual(asset["images"][slot["usable_tile_id"]].tobytes(), image.crop((x, y, x+w, y+h)).tobytes())
                    for alias in source["aliases"]:
                        self.assertEqual(asset["images"][alias["tile_id"]].tobytes(), asset["images"][usable[alias["target"]]["usable_tile_id"]].tobytes())
                    for animation in source["animations"]:
                        parsed = asset["animations"][animation["tile_id"]]
                        self.assertEqual(parsed["ids"], [usable[f["slot"]]["usable_tile_id"] for f in animation["frames"]])
                        self.assertEqual(parsed["durations"], [f["duration_ms"] for f in animation["frames"]])
                        self.assertNotEqual(parsed["ids"], sorted(parsed["ids"]))
                        self.assertIn(parsed["durations"], ([70, 130, 40], [100, 100, 100]))
            finally:
                root.close()
        self.assertEqual(geometries, {(20, 36), (44, 28)})

    def test_complete_parts_galleries_scenes_external_refs_and_bounded_pages(self):
        for size, path in self.paths.items():
            report = self.reports[size]
            self.assertEqual(report["counts"]["maps"], 7)
            self.assertEqual(report["counts"]["tilesets"], 6)
            self.assertEqual(report["counts"]["components"], 3)
            self.assertEqual(report["counts"]["animations"], 2)
            self.assertEqual(report["counts"]["static_frames"], 4)
            self.assertEqual(report["counts"]["terrain_candidates"], 31)
            provenance = read_json(path / report["provenance"]["path"])
            self.assertEqual({m["kind"] for m in provenance["maps"]}, {"source-inventory", "playback", "terrain-masks", "complete-parts", "terrain-pattern", "scene"})
            self.assertEqual(len([m for m in provenance["maps"] if m["kind"] == "terrain-pattern"]), 2)
            root = Root(path)
            try:
                for part in provenance["components"]:
                    asset = read_tileset(root, part["tsx"])
                    with Image.open(path / "originals/parts.png") as opened:
                        source = opened.convert("RGBA")
                    x, y, w, h = part["rect"]
                    self.assertEqual(asset["images"][part["tile_id"]].size, (w, h))
                    self.assertEqual(asset["images"][part["tile_id"]].tobytes(), source.crop((x, y, x+w, y+h)).tobytes())
                    if part["kind"] == "tall-cliff":
                        self.assertGreater(h, size)
                for entry in provenance["maps"]:
                    graph = parse_map(root, entry["path"], size)
                    self.assertEqual(set(visible_entities(graph)), set(entry["entities"]))
                    self.assertFalse("PASS" in entry["proof"] and entry["proof"].startswith("PASS"))
                    for page in entry["pages"] + [p for probe in entry["animation_probes"] for p in probe["pages"]]:
                        self.assertEqual(sha256((path / page["path"]).read_bytes()), page["sha256"])
                        with Image.open(path / page["path"]) as image:
                            self.assertLessEqual(max(image.size), 2000)
                    if entry["kind"] in ("playback", "scene"):
                        times = {p["elapsed_ms"] for p in entry["animation_probes"]}
                        self.assertTrue(set(animation_probes([70, 130, 40])) <= times)
                        self.assertTrue(set(animation_probes([100, 100, 100])) <= times)
                project = read_json(path / report["candidate_path"] / f"{report['consumer']}.tiled-project")
                self.assertEqual(project, {"folders": ["maps", "tilesets"], "propertyTypes": []})
                self.assertTrue(all((path / report["candidate_path"] / f).is_dir() for f in project["folders"]))
            finally:
                root.close()

    def test_complete_output_hashes_and_previous_owned_output_preservation(self):
        for size, path in self.paths.items():
            report = self.reports[size]
            inv = read_json(path / report["output_inventory"]["path"])
            self.assertEqual(sha256((path / report["output_inventory"]["path"]).read_bytes()), report["output_inventory"]["sha256"])
            self.assertEqual(len(inv["files"]), report["counts"]["output_files"])
            for file in inv["files"]:
                self.assertEqual(len((path / file["path"]).read_bytes()), file["size_bytes"])
                self.assertEqual(sha256((path / file["path"]).read_bytes()), file["sha256"])
            actual = {p.relative_to(path).as_posix() for p in (path / report["candidate_path"]).rglob("*") if p.is_file()}
            self.assertEqual(actual, {r["path"] for r in inv["files"]} | {report["output_inventory"]["path"], report["candidate_path"]+"/report.json"})
            self.assertEqual((path / "outputs/previous-approved/art.bin").read_bytes(), b"previous approved artwork must survive\x00\xff")
            self.assertEqual(read_json(path / "outputs/approved-selector.json"), {"candidate": "previous-approved", "receipt": "old"})
            for row in read_json(path / "records/inventory.json")["files"]:
                self.assertEqual(sha256((path / row["path"]).read_bytes()), row["sha256"])

    def test_relocation_unrelated_cwd_actual_cli_both_consumers(self):
        with tempfile.TemporaryDirectory(prefix="tileset-lab-relocation-") as temporary:
            directory = Path(temporary)
            code = directory / "relocated-package/python"
            shutil.copytree(PACKAGE / "python", code, ignore=shutil.ignore_patterns("__pycache__"))
            env = {**os.environ, "PYTHONPATH": str(code), "PYTHONDONTWRITEBYTECODE": "1"}
            for size, original in self.paths.items():
                consumer = directory / f"relocated-consumer-{size}"
                shutil.copytree(original, consumer)
                command = [sys.executable, "-m", "tileset_lab", "build", "--project-root", str(consumer),
                           "--manifest", "manifest.json", "--candidate-id", "relocated", "--test-trust"]
                run = subprocess.run(command, cwd="/tmp", env=env, capture_output=True, check=False)
                self.assertEqual(run.returncode, 0, run.stdout.decode()+run.stderr.decode())
                result = json.loads(run.stdout)
                self.assertEqual(result["status"], "CANDIDATE_TEST_ONLY")
                self.assertEqual(result["counts"]["originals"], 6)
                self.assertNotIn("/home/dhickel/Assets/tilesets", run.stdout.decode())
                self.assertEqual(result["tool_sha256"], self.reports[size]["tool_sha256"])
                self.assertNotIn("source_geometry", sys.modules.get("build_project", {}))
                fail = subprocess.run(command[:-1] + ["--candidate-id", "production"], cwd="/tmp", env=env, capture_output=True)
                self.assertEqual(fail.returncode, 2)
                self.assertEqual(json.loads(fail.stdout)["status"], "BLOCKED")
                self.assertIn("TEST-ONLY", json.loads(fail.stdout)["error"])


class PureAlgorithmTests(unittest.TestCase):
    def test_all_512_vertex_neighborhoods_per_mode(self):
        count = 0
        for mode in ("opaque", "alpha"):
            for bits in product((0, 1), repeat=9):
                vertices = [list(bits[row*3:row*3+3]) for row in range(3)]
                masks = field_masks(vertices)
                expected = [[sum(1 << bit for bit, (dx, dy) in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))) if bits[(y+dy)*3+x+dx])
                             for x in range(2)] for y in range(2)]
                self.assertEqual(masks, expected)
                background = 2 if mode == "opaque" else 0
                wang = [[corner_id(mask, mode) for mask in row] for row in masks]
                for y in range(2):
                    self.assertEqual(wang[y][0][1], wang[y][1][7])
                    self.assertEqual(wang[y][0][3], wang[y][1][5])
                for x in range(2):
                    self.assertEqual(wang[0][x][5], wang[1][x][7])
                    self.assertEqual(wang[0][x][3], wang[1][x][1])
                for mask in range(16):
                    expected_id = [0, 1 if mask & 2 else background, 0, 1 if mask & 4 else background,
                                   0, 1 if mask & 8 else background, 0, 1 if mask & 1 else background]
                    self.assertEqual(corner_id(mask, mode), expected_id)
                count += 1
        self.assertEqual(count, 1024)

    def test_all_81_partial_constraints_per_mode(self):
        count = 0
        for mode in ("opaque", "alpha"):
            background = 2 if mode == "opaque" else 0
            for constraints in product((None, 1, background), repeat=4):
                expected = {mask for mask in range(16) if all(c is None or c == ([background, 1][(mask >> bit) & 1]) for bit, c in enumerate(constraints))}
                self.assertEqual(set(matching_masks(constraints, mode)), expected)
                self.assertTrue(expected)
                if None not in constraints:
                    self.assertEqual(len(expected), 1)
                count += 1
        self.assertEqual(count, 162)

    def test_65536_exact_uint8_products(self):
        channels = np.arange(256, dtype=np.uint8)[:, None]
        alphas = np.arange(256, dtype=np.uint8)[None, :]
        expected = np.array([[(c*a + ((c*a) >> 8) + 128) >> 8 for a in range(256)] for c in range(256)], dtype=np.uint8)
        np.testing.assert_array_equal(byte_multiply(channels, alphas), expected)

    def test_alpha_edges_premultiply_source_over_stacks_exact_scalar_oracle(self):
        alphas = (0, 1, 127, 128, 254, 255)
        def q(c, a):
            p = c*a
            return (p+(p>>8)+128)>>8
        for alpha in alphas:
            image = Image.new("RGBA", (1, 1), (80, 120, 160, alpha))
            self.assertEqual(premultiply(image)[0, 0].tolist(), [q(c, alpha) for c in (80, 120, 160)] + [alpha])
        pixel = np.zeros((1, 1, 4), dtype=np.uint8)
        expected = [0, 0, 0, 0]
        for alpha in alphas + alphas[::-1]:
            straight = (243, 17, 153, alpha)
            source = premultiply(Image.new("RGBA", (1, 1), straight))
            prepared = [q(c, alpha) for c in straight[:3]] + [alpha]
            expected = [prepared[c]+q(expected[c], 255-alpha) for c in range(4)]
            pixel = source_over(pixel, source)
            self.assertEqual(pixel[0, 0].tolist(), expected)
        ground = premultiply(Image.new("RGBA", (1, 1), (10, 20, 30, 255)))
        red = premultiply(Image.new("RGBA", (1, 1), (255, 0, 0, 128)))
        self.assertEqual(source_over(ground, red)[0, 0].tolist(), [133, 10, 15, 255])

    def test_visible_hidden_rgb_raw_hashes_and_wrong_alpha_control(self):
        a = Image.new("RGBA", (1, 1), (240, 19, 100, 0))
        b = Image.new("RGBA", (1, 1), (1, 100, 240, 0))
        self.assertNotEqual(sha256(a.tobytes()), sha256(b.tobytes()))
        self.assertEqual(visible_digest(a), visible_digest(b))
        compare_visible(a, b, "hidden RGB")
        compare_premultiplied(np.zeros((1, 1, 4), dtype=np.uint8), a, "hidden RGB")
        expected = premultiply(Image.new("RGBA", (1, 1), (80, 120, 160, 128)))
        with self.assertRaisesRegex(Blocked, "mismatches"):
            compare_premultiplied(expected, Image.new("RGBA", (1, 1), (80, 120, 160, 129)), "wrong alpha")
        # Deliberately wrong floating/Pillow-style blend cannot pass Qt rounding.
        with self.assertRaisesRegex(Blocked, "mismatches"):
            compare_premultiplied(np.array([[[132, 10, 15, 255]]], dtype=np.uint8), Image.new("RGBA", (1, 1), (133, 10, 15, 255)), "wrong compositing")

    def test_inverse_representation_preserves_every_premultiplied_channel(self):
        grid = np.zeros((256, 256, 4), dtype=np.uint8)
        grid[:, :, :3] = np.arange(256, dtype=np.uint8)[:, None, None]
        grid[:, :, 3] = np.arange(256, dtype=np.uint8)[None, :]
        expected = premultiply(Image.fromarray(grid))
        np.testing.assert_array_equal(premultiply(unpremultiply(expected)), expected)

    def test_strict_elapsed_before_at_after_variable_default_wrap(self):
        for durations in ([70, 130, 40], [100, 100, 100], [100]):
            for elapsed in range(0, 2001):
                remaining, index = elapsed, 0
                while remaining > durations[index]:
                    remaining -= durations[index]
                    index = (index+1) % len(durations)
                self.assertEqual(frame_index_at(durations, elapsed), index, (durations, elapsed))
            self.assertEqual(frame_index_at(durations, 10**12), frame_index_at(durations, (10**12-1) % sum(durations)+1))
            boundary = 0
            for duration in durations:
                boundary += duration
                self.assertTrue({boundary-1, boundary, boundary+1} <= set(animation_probes(durations)))
        for elapsed, expected in ((69, 0), (70, 0), (71, 1), (199, 1), (200, 1), (201, 2), (239, 2), (240, 2), (241, 0), (310, 0), (311, 1), (480, 2), (481, 0)):
            self.assertEqual(frame_index_at([70, 130, 40], elapsed), expected)

    def test_pure_geometry_types_and_empty_negatives(self):
        for vertices in ([[0, 1], [0]], [[False, 0], [0, 1]], [[0, 0], [0, 2]], [[0, 0]]):
            with self.assertRaises(Blocked):
                field_masks(vertices)
        for durations, elapsed in (([], 0), ([True], 0), ([0], 0), ([-1], 0), ([100], True), ([100], -1)):
            with self.assertRaises(Blocked):
                frame_index_at(durations, elapsed)
        for constraint in ([True, 1, 2, None], [0, 0, 0, 0]):
            with self.assertRaises(Blocked):
                matching_masks(constraint, "opaque")
        with self.assertRaises(Blocked):
            corner_id(True, "opaque")


class NegativeBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tileset-lab-negative-")
        self.path = copy_fixture(Path(self.temp.name) / "consumer", 16)

    def tearDown(self):
        self.temp.cleanup()

    def prepare(self):
        self.report = inspect(self.path)
        return trust_record(self.path, self.report)

    def test_closed_duplicate_unknown_boolean_nonfinite_json(self):
        for content in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}', b'{"a":-Infinity}',
                        b'{"a":1e999}', b'{"a":-1e999}', b'{} garbage'):
            with self.assertRaises(Blocked):
                parse_json(content, "negative")
        initial = read_json(self.path / "manifest.json")
        mutations = []
        for key, value in (("cell_size", True), ("cell_size", 24), ("profile", "mixed"), ("schema_version", True), ("id", "../unsafe"),
                           ("output_root", "originals/generated"), ("output_root", "data"), ("output_root", "reviews"),
                           ("output_root", "../escape"), ("scenes", "/etc/passwd"), ("inventory", "a//b"),
                           ("frozen_reference", "data/../frozen.json"), ("source_review", "C:\\review.json")):
            wrong = deepcopy(initial)
            wrong[key] = value
            mutations.append(wrong)
        wrong = deepcopy(initial); wrong["unknown"] = 1; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["sources"][0]["unknown"] = 1; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["sources"][0]["slots"][0]["rect"][0] = True; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["originals"][0]["license"] = "missing"; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["licenses"][0]["grant"] = ""; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["licenses"] += deepcopy(wrong["licenses"]); mutations.append(wrong)
        wrong = deepcopy(initial); wrong["sources"].pop(); mutations.append(wrong)
        wrong = deepcopy(initial); wrong["packs"].append(deepcopy(wrong["packs"][0])); mutations.append(wrong)
        wrong = deepcopy(initial); wrong["sources"][2]["animations"][0]["frames"][0]["duration_ms"] = True; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["sources"][2]["animations"][1]["frames"][0]["duration_ms"] = 99; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["sources"][2]["aliases"][0]["target"] = "slot-2"; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["sources"][2]["animations"][0]["frames"][0]["slot"] = "slot-2"; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["sources"][2]["aliases"][0]["id"] = "slot-0"; mutations.append(wrong)
        for index, wrong in enumerate(mutations):
            set_json(self.path / "manifest.json", wrong)
            root = Root(self.path)
            try:
                with self.subTest(index=index), self.assertRaises(Blocked):
                    load_manifest(Inputs(root), "manifest.json")
            finally:
                root.close()
        set_json(self.path / "manifest.json", initial)

    def test_symlink_input_output_absent_parents_root_and_external_escapes(self):
        doc = read_json(self.path / "manifest.json")
        root = Root(self.path)
        try:
            (self.path / "linked").symlink_to(self.path / "data", target_is_directory=True)
            for value in ("linked/catalog.json", "linked/future/deep/output"):
                with self.assertRaises(Blocked):
                    root.check_path(value)
            (self.path / "outputs/linked").symlink_to(self.path / "originals", target_is_directory=True)
            wrong = deepcopy(doc); wrong["output_root"] = "outputs/linked/new"
            set_json(self.path / "manifest.json", wrong)
            with self.assertRaises(Blocked):
                load_manifest(Inputs(root), "manifest.json")
            for reference in ("../../../../etc/passwd", "/etc/passwd", "file:/etc/passwd", "..\\originals\\help.txt"):
                with self.assertRaises(Blocked):
                    resolve_reference(root, "outputs/example.tmx", reference)
            alias = Path(self.temp.name) / "root-alias"
            alias.symlink_to(self.path, target_is_directory=True)
            with self.assertRaises(Blocked):
                Root(alias)
        finally:
            root.close()

    def test_inventory_requires_explicit_init_never_replaces_existing_snapshot(self):
        with self.assertRaisesRegex(Blocked, "Missing source inventory"):
            inspect(self.path, initialize=False)
        first = inspect(self.path)
        before = (self.path / "records/inventory.json").read_bytes()
        inode = (self.path / "records/inventory.json").stat().st_ino
        second = inspect(self.path, "second", initialize=True)
        self.assertEqual(before, (self.path / "records/inventory.json").read_bytes())
        self.assertEqual(inode, (self.path / "records/inventory.json").stat().st_ino)
        self.assertFalse(first["source_visual_approval"])
        self.assertEqual(second["status"], "UNAPPROVED")
        self.assertFalse((self.path / "reviews/source.json").exists())

    def test_changed_missing_renamed_unexpected_originals(self):
        self.prepare()
        help_path = self.path / "originals/help.txt"
        before = help_path.read_bytes()
        help_path.write_bytes(before + b"changed")
        with self.assertRaisesRegex(Blocked, "changed=.*help.txt"):
            build(self.path)
        help_path.write_bytes(before)
        renamed = self.path / "originals/renamed.txt"
        help_path.rename(renamed)
        with self.assertRaisesRegex(Blocked, "missing=.*help.txt.*unexpected=.*renamed.txt"):
            build(self.path)
        renamed.rename(help_path)
        rogue = self.path / "originals/.unexpected"
        rogue.write_bytes(b"new closed-scope file")
        with self.assertRaisesRegex(Blocked, "unexpected=.*unexpected"):
            build(self.path)
        rogue.unlink()
        help_path.unlink()
        with self.assertRaisesRegex(Blocked, "missing=.*help.txt"):
            build(self.path)
        self.assertFalse((self.path / "outputs/candidates/candidate").exists())
        self.assertEqual(read_json(self.path / "outputs/approved-selector.json")["candidate"], "previous-approved")

    def test_changed_original_png_honest_dimensions_not_rebaselined(self):
        self.prepare()
        path = self.path / "originals/terrain.png"
        image = Image.open(path).convert("RGBA")
        pixel = image.getpixel((1, 1)); image.putpixel((1, 1), (pixel[0]^1, *pixel[1:])); image.save(path)
        with self.assertRaisesRegex(Blocked, "changed=.*terrain.png"):
            build(self.path)

    def test_inventory_schema_license_size_dimension_digest_negatives(self):
        self.prepare()
        original = read_json(self.path / "records/inventory.json")
        mutations = []
        for key, value in (("schema_version", True), ("hash_algorithm", "md5"), ("extra", 1)):
            wrong = deepcopy(original); wrong[key] = value; mutations.append(wrong)
        for key, value in (("size_bytes", True), ("png_size", [True, 16]), ("sha256", "bad"), ("license", "unknown")):
            wrong = deepcopy(original); wrong["files"][0][key] = value; mutations.append(wrong)
        wrong = deepcopy(original); wrong["files"].append(deepcopy(wrong["files"][0])); mutations.append(wrong)
        wrong = deepcopy(original); wrong["files"].pop(); mutations.append(wrong)
        for wrong in mutations:
            set_json(self.path / "records/inventory.json", wrong)
            with self.assertRaises(Blocked):
                guard(self.path)
        set_json(self.path / "records/inventory.json", original)
        (self.path / "originals/LICENSE.txt").write_bytes(b"")
        with self.assertRaises(Blocked):
            guard(self.path)

    def test_missing_partial_duplicate_negative_stale_author_unavailable_reviews(self):
        record = self.prepare()
        mutations = []
        wrong = deepcopy(record); wrong["entries"].pop(); mutations.append(wrong)
        wrong = deepcopy(record); wrong["entries"].append(deepcopy(wrong["entries"][0])); mutations.append(wrong)
        wrong = deepcopy(record); wrong["verdict"] = "BLOCKED"; mutations.append(wrong)
        wrong = deepcopy(record); wrong["entries"][0]["verdict"] = "BLOCKED"; mutations.append(wrong)
        wrong = deepcopy(record); wrong["entries"][0]["observations"] = ""; mutations.append(wrong)
        wrong = deepcopy(record); wrong["reviewer"]["id"] = wrong["reviewer"]["independent_of"]; mutations.append(wrong)
        wrong = deepcopy(record); wrong["reviewer"]["image_capable"] = False; mutations.append(wrong)
        wrong = deepcopy(record); wrong["tool_sha256"] = "0"*64; mutations.append(wrong)
        wrong = deepcopy(record); wrong["packet"]["sha256"] = "0"*64; mutations.append(wrong)
        wrong = deepcopy(record); wrong["entries"][0]["binding"]["coordinate"] = [1, 1]; mutations.append(wrong)
        wrong = deepcopy(record); wrong["entries"][0]["binding"]["page"]["sha256"] = "0"*64; mutations.append(wrong)
        wrong = deepcopy(record); wrong["entries"][0]["extra"] = 1; mutations.append(wrong)
        wrong = deepcopy(record); wrong["extra"] = 1; mutations.append(wrong)
        for index, wrong in enumerate(mutations):
            set_json(self.path / "reviews/source.json", wrong)
            with self.subTest(index=index), self.assertRaises(Blocked):
                guard(self.path)
        set_json(self.path / "reviews/source.json", record)
        with self.assertRaisesRegex(Blocked, "TEST-ONLY"):
            guard(self.path, test=False)
        (self.path / "reviews/source.json").unlink()
        with self.assertRaises(Blocked):
            build(self.path)

    def test_honest_hash_convex_as_concave_and_direction_swaps_keep_frozen_oracle(self):
        paths = [self.path, copy_fixture(Path(self.temp.name) / "consumer-32", 32)]
        checked = 0
        for path in paths:
            initial = read_json(path / "data/catalog.json")
            oracle = (path / "references/frozen.json").read_bytes()
            for family_index in range(2):
                for role, wrong_role in (("concave-NW", "convex-NW"), ("edge-N", "edge-S"), ("convex-NE", "convex-SW")):
                    catalog = deepcopy(initial)
                    family = catalog["families"][family_index]
                    family["roles"][role] = family["roles"][wrong_role]
                    set_json(path / "data/catalog.json", catalog)
                    id = f"wrong-{family['id']}-{role.lower()}"
                    report = inspect(path, id)
                    record = trust_record(path, report)
                    self.assertEqual(record["entries"][0]["binding"]["catalog_sha256"], sha256((path / "data/catalog.json").read_bytes()))
                    self.assertEqual((path / "references/frozen.json").read_bytes(), oracle)
                    with self.subTest(path=path, family=family["id"], role=role), self.assertRaisesRegex(Blocked, "full source role/pixel mismatch.*visible RGBA pixel mismatches"):
                        guard(path)
                    with self.assertRaisesRegex(Blocked, "full source role/pixel mismatch"):
                        build(path, id)
                    self.assertFalse((path / f"outputs/candidates/{id}").exists())
                    checked += 1
            set_json(path / "data/catalog.json", initial)
        self.assertEqual(checked, 12)

    def test_wrong_original_frozen_crop_and_forbidden_refresh(self):
        self.prepare()
        reference_path = self.path / "references/frozen.json"
        reference = read_json(reference_path)
        role = reference["families"][0]["roles"][10]
        original_frozen = self.path / role["image"]
        image = Image.open(self.path / reference["families"][0]["roles"][2]["image"]).convert("RGBA")
        image.save(original_frozen)
        # Honest byte/pixel hashes for the WRONG crop, but keep independent correct source coordinate.
        role["image_sha256"] = sha256(original_frozen.read_bytes())
        role["visible_rgba_sha256"] = visible_digest(image)
        set_json(reference_path, reference)
        with self.assertRaisesRegex(Blocked, "independent frozen/source correspondence.*pixel mismatches"):
            guard(self.path)
        with self.assertRaisesRegex(Blocked, "independent frozen/source correspondence"):
            inspect(self.path, "no-refresh")
        self.assertEqual(read_json(reference_path), reference)

    def test_stale_catalog_frozen_page_tool_hashes(self):
        self.prepare()
        catalog_path = self.path / "data/catalog.json"
        original = catalog_path.read_bytes()
        catalog = read_json(catalog_path); catalog["families"][0]["name"] += " changed"
        set_json(catalog_path, catalog)
        with self.assertRaisesRegex(Blocked, "Stale source catalog hash"):
            guard(self.path)
        catalog_path.write_bytes(original)
        packet_path = self.path / self.report["packet"]["path"]
        original_packet = packet_path.read_bytes()
        packet = read_json(packet_path)
        page = self.path / packet["pages"][0]["path"]
        bytes_before = page.read_bytes(); page.write_bytes(bytes_before+b"trailing data")
        with self.assertRaisesRegex(Blocked, "viewed image hash drift"):
            guard(self.path)
        page.write_bytes(bytes_before)
        packet["tool"]["sha256"] = "0"*64
        set_json(packet_path, packet)
        record = read_json(self.path / "reviews/source.json")
        record["packet"]["sha256"] = sha256(packet_path.read_bytes())
        set_json(self.path / "reviews/source.json", record)
        with self.assertRaisesRegex(Blocked, "Stale source tool"):
            guard(self.path)
        packet_path.write_bytes(original_packet)

    def test_family_schema_full_roles_materials_bounds_opaque_authored_alpha(self):
        initial = read_json(self.path / "data/catalog.json")
        mutations = []
        wrong = deepcopy(initial); wrong["families"][0]["roles"].pop("solid"); mutations.append(wrong)
        wrong = deepcopy(initial); wrong["families"][0]["roles"]["origin"] = [0, 0]; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["families"][0]["roles"]["solid"] = [True, 0]; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["families"][0]["roles"]["solid"] = [99, 99]; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["families"][0]["foreground"] = wrong["families"][0]["background"]; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["families"][0]["mode"] = "alpha"; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["families"][1]["mode"] = "opaque"; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["families"][1]["roles"]["background"] = wrong["families"][1]["roles"]["solid"]; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["families"][1]["roles"]["solid"] = wrong["families"][1]["roles"]["background"]; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["families"].append(deepcopy(wrong["families"][0])); mutations.append(wrong)
        wrong = deepcopy(initial); wrong["components"][0]["rect"][3] = 8; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["components"][0]["rect"] = [90, 90, 20, 20]; mutations.append(wrong)
        wrong = deepcopy(initial); wrong["components"][0]["rect"] = [4, 7, 12, 0]; mutations.append(wrong)
        for index, wrong in enumerate(mutations):
            set_json(self.path / "data/catalog.json", wrong)
            root = Root(self.path)
            try:
                inputs = Inputs(root); manifest = load_manifest(inputs, "manifest.json")
                with self.subTest(index=index), self.assertRaises(Blocked):
                    load_catalogs(inputs, manifest, load_sources(inputs, manifest))
            finally:
                root.close()
        set_json(self.path / "data/catalog.json", initial)

    def test_complete_sprite_grid_empty_slot_and_rectangle_negatives(self):
        initial = read_json(self.path / "manifest.json")
        for kind in ("grid", "empty", "partial", "duplicate"):
            wrong = deepcopy(initial)
            if kind == "grid":
                wrong["sources"][2]["slots"].pop()
            elif kind == "empty":
                wrong["sources"][2]["slots"][2]["empty"] = False
            elif kind == "partial":
                wrong["sources"][2]["slots"][0]["rect"][2] -= 1
            else:
                wrong["sources"][2]["slots"].append(deepcopy(wrong["sources"][2]["slots"][0]))
            set_json(self.path / "manifest.json", wrong)
            root = Root(self.path)
            try:
                with self.assertRaises(Blocked):
                    inputs = Inputs(root); manifest = load_manifest(inputs, "manifest.json"); load_sources(inputs, manifest)
            finally:
                root.close()
        set_json(self.path / "manifest.json", initial)

    def test_source_input_concurrent_inode_replacement_and_in_place_change(self):
        root = Root(self.path)
        try:
            inputs = Inputs(root); before = inputs.read("originals/help.txt")
            changed = self.path / "originals/new-name.txt"
            changed.write_bytes(before); changed.replace(self.path / "originals/help.txt")
            with self.assertRaisesRegex(Blocked, "changed/replaced"):
                inputs.recheck()
            inputs = Inputs(root); inputs.read("originals/help.txt")
            (self.path / "originals/help.txt").write_bytes(before+b"edit")
            with self.assertRaisesRegex(Blocked, "changed/replaced"):
                inputs.recheck()
        finally:
            root.close()

    def test_real_cross_process_lock_no_theft_and_foreign_lock(self):
        root = Root(self.path)
        env = {**os.environ, "PYTHONPATH": str(PACKAGE / "python"), "PYTHONDONTWRITEBYTECODE": "1"}
        script = "from tileset_lab.manifest import Root; import sys; r=Root(sys.argv[1]);\nwith r.lock(): print('ACQUIRED')\nr.close()"
        try:
            with root.lock():
                run = subprocess.run([sys.executable, "-c", script, str(self.path)], env=env, capture_output=True)
                self.assertNotEqual(run.returncode, 0)
                self.assertIn(b"locked by another operation", run.stderr)
            run = subprocess.run([sys.executable, "-c", script, str(self.path)], env=env, capture_output=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(run.stdout.strip(), b"ACQUIRED")
            (self.path / ".tileset-lab.lock").write_bytes(b"foreign lock content")
            with self.assertRaisesRegex(Blocked, "ownership uncertain"):
                with root.lock():
                    self.fail("foreign lock was accepted")
        finally:
            root.close()

    def test_candidate_collision_preserves_originals_and_old_outputs(self):
        self.prepare()
        report = build(self.path)
        before = {p.relative_to(self.path).as_posix(): sha256(p.read_bytes()) for p in self.path.rglob("*") if p.is_file()}
        with self.assertRaisesRegex(Blocked, "File exists"):
            build(self.path)
        after = {p.relative_to(self.path).as_posix(): sha256(p.read_bytes()) for p in self.path.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        self.assertFalse(report["native_proof"])
        self.assertFalse(report["native_visual_approval"])

    def test_scene_hidden_invalid_field_reference_draw_order_and_clipping(self):
        self.prepare()
        initial = read_json(self.path / "data/scenes.json")
        mutations = []
        wrong = deepcopy(initial); wrong["scenes"][0]["layers"][1]["visible"] = False; mutations.append((wrong, "Hidden required"))
        wrong = deepcopy(initial); wrong["scenes"][0]["layers"][2]["placements"][0]["visible"] = False; mutations.append((wrong, "Hidden required"))
        wrong = deepcopy(initial); wrong["scenes"][0]["layers"][0]["vertices"].pop(); mutations.append((wrong, "dimensions"))
        wrong = deepcopy(initial); wrong["scenes"][0]["layers"][2]["placements"][0]["target"] = "unknown"; mutations.append((wrong, "Unknown complete"))
        wrong = deepcopy(initial); wrong["scenes"][0]["layers"].reverse(); mutations.append((wrong, "draw order"))
        wrong = deepcopy(initial); wrong["scenes"][0]["layers"][2]["placements"][0]["x"] = 999; mutations.append((wrong, "Clipped complete"))
        wrong = deepcopy(initial); wrong["patterns"].pop(); mutations.append((wrong, "every family"))
        wrong = deepcopy(initial); wrong["scenes"][0]["unknown"] = 1; mutations.append((wrong, "fields"))
        # Manifest binds the scene path, not mutable data bytes; each run snapshots and rechecks it.
        for index, (wrong, message) in enumerate(mutations):
            set_json(self.path / "data/scenes.json", wrong)
            with self.subTest(index=index), self.assertRaisesRegex(Blocked, message):
                build(self.path, f"scene-negative-{index}")
        set_json(self.path / "data/scenes.json", initial)

    def test_actual_xml_effective_visibility_scaling_and_nonocclusion_not_presence(self):
        self.prepare()
        report = build(self.path)
        provenance = read_json(self.path / report["provenance"]["path"])
        entry = next(m for m in provenance["maps"] if m["kind"] == "scene")
        map_path = self.path / entry["path"]
        original = map_path.read_bytes()
        root = Root(self.path)
        try:
            mutations = []
            node = ET.fromstring(original); node.find("objectgroup").set("visible", "0"); mutations.append((node, "Hidden"))
            node = ET.fromstring(original); node.find("objectgroup/object").set("visible", "0"); mutations.append((node, "Hidden"))
            node = ET.fromstring(original); node.find("objectgroup/object").set("width", "1"); mutations.append((node, "Scaled/incomplete"))
            node = ET.fromstring(original); node.find("objectgroup/object").set("y", "0"); mutations.append((node, "Clipped complete"))
            node = ET.fromstring(original)
            group = node.find("objectgroup"); node.remove(group)
            parent = ET.SubElement(node, "group", id=node.get("nextlayerid"), visible="0", opacity="1")
            node.set("nextlayerid", str(int(node.get("nextlayerid"))+1)); parent.append(group); mutations.append((node, "Hidden"))
            for node, message in mutations:
                map_path.write_bytes(ET.tostring(node))
                with self.assertRaisesRegex(Blocked, message):
                    parse_map(root, entry["path"], 16)
            node = ET.fromstring(original)
            group = node.find("objectgroup"); covered = deepcopy(group.find("object"))
            covered.set("id", node.get("nextobjectid")); covered.set("name", "occluder")
            covered.find("properties/property[@name='entity']").set("value", "occluder")
            node.set("nextobjectid", str(int(node.get("nextobjectid"))+1)); group.append(covered)
            map_path.write_bytes(ET.tostring(node))
            graph = parse_map(root, entry["path"], 16)
            self.assertTrue(graph["xml"].findall(".//object"))
            with self.assertRaisesRegex(Blocked, "Fully occluded"):
                visible_entities(graph)
            map_path.write_bytes(original)
        finally:
            root.close()

    def test_honest_empty_xml_tile_and_incomplete_component_geometry_rejected(self):
        self.prepare()
        report = build(self.path)
        root = Root(self.path)
        try:
            provenance = read_json(self.path / report["provenance"]["path"])
            source = next(s for s in provenance["sources"] if s["id"] == "terrain")
            scene = next(m for m in provenance["maps"] if m["kind"] == "scene")
            map_path = self.path / scene["path"]
            node = ET.fromstring(map_path.read_bytes())
            empty_slot = next(s for s in source["slots"] if s["empty"])
            with Image.open(self.path / source["path"]) as sheet:
                columns = sheet.width // 16
            x, y = empty_slot["rect"][:2]
            target_gid = 1000 + (y//16)*columns+x//16
            ET.SubElement(node, "tileset", firstgid="1000", source=os.path.relpath(self.path/source["tsx"], map_path.parent))
            obj = node.find("objectgroup/object"); obj.set("gid", str(target_gid)); obj.set("width", "16"); obj.set("height", "16")
            map_path.write_bytes(ET.tostring(node))
            with self.assertRaisesRegex(Blocked, "Empty required artwork"):
                parse_map(root, scene["path"], 16)
            image = Image.open(self.path / "originals/parts.png").convert("RGBA")
            with self.assertRaisesRegex(Blocked, "out of bounds"):
                validate_complete_rectangle(image, [4, 8, 12, image.height], "clipped cliff")
        finally:
            root.close()

    def test_stacked_partial_alpha_final_rounding_can_fully_hide_required_art(self):
        original = Image.new("RGBA", (1, 1), (255, 0, 0, 1))
        cover = Image.new("RGBA", (1, 1), (0, 0, 255, 128))
        primitives = [{"image": original, "animation": None, "x": 0, "y": 0, "entity": "required"}]
        primitives.extend({"image": cover, "animation": None, "x": 0, "y": 0, "entity": "cover"} for _ in range(10))
        graph = {"size": [1, 1], "primitives": primitives}
        with self.assertRaisesRegex(Blocked, "Fully occluded.*required"):
            visible_entities(graph)


if __name__ == "__main__":
    unittest.main()
