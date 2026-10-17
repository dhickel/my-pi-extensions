"""Declared completeness is geometry, not transparent gutters or alpha isolation."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

from PIL import Image

from test_core import build, copy_fixture, inspect, read_json, set_json, trust_record
from tileset_lab.manifest import Blocked, Inputs, Root, load_manifest, sha256
from tileset_lab.maps import parse_map, read_tileset, visible_entities
from tileset_lab.sources import load_sources
from tileset_lab.terrain import validate_complete_rectangle


class CompletenessContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tileset-lab-completeness-")
        self.directory = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def load(self, path):
        root = Root(path)
        try:
            inputs = Inputs(root)
            return load_sources(inputs, load_manifest(inputs, "manifest.json"))
        finally:
            root.close()

    def test_bounded_opaque_and_alpha_components_do_not_infer_object_boundaries(self):
        sparse = Image.new("RGBA", (64, 64), (19, 37, 53, 0))
        for coordinate in range(64):
            sparse.putpixel((coordinate, 32), (40, 80, 120, 127))
            sparse.putpixel((32, coordinate), (90, 50, 30, 1))
        for image in (Image.new("RGBA", (64, 64), (50, 100, 150, 255)),
                      Image.new("RGBA", (64, 64), (50, 100, 150, 128)), sparse):
            before = image.tobytes()
            for rect in ([16, 16, 32, 32], [0, 0, 64, 64]):
                with self.subTest(alpha=image.getchannel("A").getextrema(), rect=rect):
                    validate_complete_rectangle(image, rect, "explicit complete stamp")
            self.assertEqual(image.tobytes(), before)

    def test_component_malformed_out_of_bounds_and_empty_geometry_still_blocks(self):
        image = Image.new("RGBA", (64, 64), (50, 100, 150, 255))
        malformed = ([0, 0, 32], [0, 0, 32, 32, 1], (0, 0, 32, 32),
                     [False, 0, 32, 32], [0, 0, True, 32], [0, 0, 0, 32],
                     [-1, 0, 32, 32], [0, -1, 32, 32], [0, 0, 32, -1],
                     [0.5, 0, 32, 32], [0, 0, "32", 32], [33, 0, 32, 32],
                     [0, 33, 32, 32])
        for rect in malformed:
            with self.subTest(rect=rect), self.assertRaises(Blocked):
                validate_complete_rectangle(image, rect, "invalid complete stamp")
        with self.assertRaisesRegex(Blocked, "empty complete artwork"):
            validate_complete_rectangle(Image.new("RGBA", (64, 64), (99, 88, 77, 0)),
                                        [16, 16, 32, 32], "empty stamp")

    def test_frame_rectangles_must_match_the_entire_declared_slot_grid(self):
        for size in (16, 32):
            path = copy_fixture(self.directory / str(size), size)
            original = read_json(path / "manifest.json")
            sprite = next(s for s in original["sources"] if s["kind"] == "sprite")
            w, h = sprite["frame_size"]
            mutations = []
            for label, rect in (("cropped width", [0, 0, w-1, h]),
                                ("cropped height", [0, 0, w, h-1]),
                                ("shifted slot", [1, 0, w, h]),
                                ("out of bounds", [w*3, 0, w, h]),
                                ("negative", [-1, 0, w, h]),
                                ("boolean", [False, 0, w, h]),
                                ("float", [0, 0, float(w), h]),
                                ("missing dimension", [0, 0, w])):
                wrong = deepcopy(original)
                wrong["sources"][-1]["slots"][0]["rect"] = rect
                mutations.append((label, wrong))
            wrong = deepcopy(original); wrong["sources"][-1]["slots"].pop()
            mutations.append(("missing slot", wrong))
            wrong = deepcopy(original); wrong["sources"][-1]["slots"].append(deepcopy(sprite["slots"][0]))
            mutations.append(("duplicate slot", wrong))
            wrong = deepcopy(original); wrong["sources"][-1]["frame_size"] = [0, h]
            mutations.append(("zero canvas", wrong))
            for label, wrong in mutations:
                set_json(path / "manifest.json", wrong)
                with self.subTest(size=size, case=label), self.assertRaises(Blocked):
                    self.load(path)
            set_json(path / "manifest.json", original)

    def test_cropped_canvas_and_dishonest_or_entirely_empty_frames_still_block(self):
        for size in (16, 32):
            path = copy_fixture(self.directory / str(size), size)
            original = read_json(path / "manifest.json")
            sprite = original["sources"][-1]
            image_path = path / sprite["path"]
            original_bytes = image_path.read_bytes()
            with Image.open(image_path) as opened:
                opened.crop((0, 0, opened.width-1, opened.height)).save(image_path)
            with self.subTest(size=size, case="cropped source canvas"), self.assertRaisesRegex(Blocked, "Non-integral complete frame grid"):
                self.load(path)
            image_path.write_bytes(original_bytes)
            wrong = deepcopy(original)
            next(s for s in wrong["sources"][-1]["slots"] if s["empty"])["empty"] = False
            set_json(path / "manifest.json", wrong)
            with self.subTest(size=size, case="dishonest empty"), self.assertRaisesRegex(Blocked, "dishonest empty slot"):
                self.load(path)
            wrong = deepcopy(original)
            for slot in wrong["sources"][-1]["slots"]:
                slot["empty"] = True
            wrong["sources"][-1]["animations"] = []
            wrong["sources"][-1]["aliases"] = []
            set_json(path / "manifest.json", wrong)
            with Image.open(image_path) as opened:
                Image.new("RGBA", opened.size, (99, 88, 77, 0)).save(image_path)
            with self.subTest(size=size, case="entirely empty"), self.assertRaisesRegex(Blocked, "entirely empty source"):
                self.load(path)

    def test_aliases_still_require_direct_registered_nonempty_frames(self):
        for size in (16, 32):
            path = copy_fixture(self.directory / str(size), size)
            original = read_json(path / "manifest.json")
            sprite = original["sources"][-1]
            targets = ("missing-slot", next(s["id"] for s in sprite["slots"] if s["empty"]),
                       sprite["aliases"][0]["id"])
            for target in targets:
                wrong = deepcopy(original)
                wrong["sources"][-1]["aliases"][0]["target"] = target
                set_json(path / "manifest.json", wrong)
                with self.subTest(size=size, target=target), self.assertRaisesRegex(Blocked, "registered nonempty frame"):
                    self.load(path)

    def test_real_guarded_builds_preserve_whole_opaque_and_border_touching_alpha_art(self):
        for size in (16, 32):
            for mode in ("opaque", "alpha"):
                with self.subTest(size=size, mode=mode):
                    path = copy_fixture(self.directory / f"{size}-{mode}", size)
                    manifest = read_json(path / "manifest.json")
                    sprite = next(s for s in manifest["sources"] if s["kind"] == "sprite")
                    with Image.open(path / sprite["path"]) as opened:
                        sheet = Image.new("RGBA", opened.size, (9, 18, 27, 0))
                    frames = {}
                    for index, slot in enumerate(sprite["slots"]):
                        if slot["empty"]:
                            continue
                        x, y, w, h = slot["rect"]
                        frame = Image.new("RGBA", (w, h), (31+index*30, 79, 133, 255 if mode == "opaque" else 0))
                        for point, alpha in zip(((0, 0), (w-1, 0), (w-1, h-1), (0, h-1)), (1, 127, 128, 254)):
                            frame.putpixel(point, (203, 57+index*10, 99, 255 if mode == "opaque" else alpha))
                        frames[slot["id"]] = frame
                        sheet.paste(frame, (x, y))
                    sheet.save(path / sprite["path"])
                    parts = next(s for s in manifest["sources"] if s["id"] == "parts")
                    with Image.open(path / parts["path"]) as opened:
                        part_sheet = Image.new("RGBA", opened.size, (63, 91, 129, 255 if mode == "opaque" else 127))
                    part_sheet.save(path / parts["path"])
                    for slot in parts["slots"]:
                        slot["empty"] = False
                    set_json(path / "manifest.json", manifest)
                    protected = {p: sha256(p.read_bytes()) for folder in ("originals", "references", "data")
                                 for p in (path / folder).rglob("*") if p.is_file()}
                    protected[path / "manifest.json"] = sha256((path / "manifest.json").read_bytes())
                    protected[path / "outputs/approved-selector.json"] = sha256((path / "outputs/approved-selector.json").read_bytes())
                    packet = inspect(path)
                    self.assertFalse(packet["source_visual_approval"])
                    trust_record(path, packet)
                    with self.assertRaisesRegex(Blocked, "TEST-ONLY"):
                        build(path, "production", test=False)
                    self.assertFalse((path / "outputs/candidates/production").exists())
                    report = build(path)
                    self.assertEqual(report["status"], "CANDIDATE_TEST_ONLY")
                    self.assertFalse(report["selected"])
                    self.assertFalse(report["source_approval"]["actual_visual_approval"])
                    provenance = read_json(path / report["provenance"]["path"])
                    source = next(s for s in provenance["sources"] if s["id"] == sprite["id"])
                    root = Root(path)
                    try:
                        asset = read_tileset(root, source["tsx"])
                        slots = {s["id"]: s for s in source["slots"] if not s["empty"]}
                        self.assertEqual(len(slots), 4)
                        self.assertEqual(sum(s["empty"] for s in source["slots"]), 2)
                        for slot in source["slots"]:
                            if slot["empty"]:
                                self.assertIsNone(slot["usable_tile_id"])
                                self.assertIsNone(slot["alpha_bbox"])
                                continue
                            local = slot["usable_tile_id"]
                            self.assertEqual(slot["alpha_bbox"], [0, 0, *sprite["frame_size"]])
                            self.assertEqual(asset["rectangles"][local], {"path": sprite["path"], "rect": slot["rect"]})
                            self.assertEqual(asset["images"][local].tobytes(), frames[slot["id"]].tobytes())
                        for alias in source["aliases"]:
                            self.assertEqual(asset["images"][alias["tile_id"]].tobytes(), frames[alias["target"]].tobytes())
                            self.assertEqual(asset["rectangles"][alias["tile_id"]]["rect"], slots[alias["target"]]["rect"])
                        for animation in source["animations"]:
                            parsed = asset["animations"][animation["tile_id"]]
                            self.assertEqual(parsed["durations"], [f["duration_ms"] for f in animation["frames"]])
                            for local, frame in zip(parsed["ids"], animation["frames"]):
                                self.assertEqual(asset["images"][local].tobytes(), frames[frame["slot"]].tobytes())
                        for part in provenance["components"]:
                            x, y, w, h = part["rect"]
                            parts_asset = read_tileset(root, part["tsx"])
                            actual = parts_asset["images"][part["tile_id"]]
                            self.assertEqual(actual.size, (w, h))
                            self.assertEqual(actual.tobytes(), part_sheet.crop((x, y, x+w, y+h)).tobytes())
                            tile = parts_asset["xml"].find(f"tile[@id='{part['tile_id']}']")
                            self.assertEqual(tile.find("properties/property[@name='source_rect']").get("value"), ",".join(map(str, part["rect"])))
                        for entry in provenance["maps"]:
                            self.assertEqual(set(visible_entities(parse_map(root, entry["path"], size))), set(entry["entities"]))
                            for page in entry["pages"] + [p for probe in entry["animation_probes"] for p in probe["pages"]]:
                                with Image.open(path / page["path"]) as opened:
                                    self.assertLessEqual(max(opened.size), 2000)
                    finally:
                        root.close()
                    self.assertEqual({p: sha256(p.read_bytes()) for p in protected}, protected)

    def test_serialized_cropped_frames_and_honest_trimmed_component_pngs_still_block(self):
        path = copy_fixture(self.directory / "consumer", 16)
        trust_record(path, inspect(path))
        report = build(path)
        provenance = read_json(path / report["provenance"]["path"])
        sprite = next(s for s in provenance["sources"] if s["kind"] == "sprite")
        tsx_path = path / sprite["tsx"]
        original = tsx_path.read_bytes()
        root = Root(path)
        try:
            for kind in ("cropped", "out-of-bounds", "empty"):
                node = ET.fromstring(original)
                tile = node.find("tile")
                if kind == "cropped":
                    tile.set("width", str(int(tile.get("width"))-1))
                elif kind == "out-of-bounds":
                    tile.set("x", tile.find("image").get("width"))
                else:
                    empty = next(s for s in sprite["slots"] if s["empty"])
                    tile.set("x", str(empty["rect"][0])); tile.set("y", str(empty["rect"][1]))
                tsx_path.write_bytes(ET.tostring(node))
                with self.subTest(kind=kind), self.assertRaisesRegex(Blocked, "incomplete|out-of-bounds"):
                    read_tileset(root, sprite["tsx"])
            tsx_path.write_bytes(original)
            part = provenance["components"][0]
            parts_asset = read_tileset(root, part["tsx"])
            png_path = path / parts_asset["rectangles"][part["tile_id"]]["path"]
            image = parts_asset["images"][part["tile_id"]]
            image.crop((0, 0, image.width, image.height-1)).save(png_path)
            node = parts_asset["xml"]
            node.find(f"tile[@id='{part['tile_id']}']/image").set("height", str(image.height-1))
            (path / part["tsx"]).write_bytes(ET.tostring(node))
            gallery = next(m for m in provenance["maps"] if m["kind"] == "complete-parts")
            with self.assertRaisesRegex(Blocked, "Scaled/incomplete"):
                parse_map(root, gallery["path"], 16)
        finally:
            root.close()
