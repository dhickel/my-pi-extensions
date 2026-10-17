"""One-time CC0 fixture artwork authorship, NOT an inspect/build/reference refresh.

The two drawings are made directly at native resolution with distinct shapes,
textures, layouts, sprite/part geometry, and scenes. No RPGW input is read.
A frozen full-cell source reference is authored here before catalog mutation;
production inspect/build never calls this script or updates those references.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROLES = ("background", "solid", "convex-NW", "convex-NE", "convex-SE", "convex-SW",
         "edge-N", "edge-E", "edge-S", "edge-W", "concave-NW", "concave-NE", "concave-SE", "concave-SW")
# These full source locations belong to the new drawings, not an inferred atlas pattern.
PLACEMENTS = {
    16: ((7, 25, 3, 18, 31, 11, 2, 28, 14, 22, 5, 20, 33, 9),
         (0, 16, 30, 13, 26, 6, 23, 10, 32, 4, 19, 1, 27, 15)),
    32: ((29, 4, 17, 0, 25, 12, 7, 22, 2, 19, 30, 9, 15, 26),
         (10, 27, 3, 21, 6, 31, 14, 1, 24, 18, 8, 28, 5, 20)),
}
AUTHOR = "cc0-fixture-author:01a12b9c-b128-77bb-9db9-9a16433c24a6"


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(content)


def save(path, image):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        image.save(stream, format="PNG", compress_level=9)


def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def terrain_cell(size, role, sparse):
    """Full source contours: outward corners versus inward, large corner holes.

    Inward quarter sampling is the accepted profile. Convex-X foreground extends
    opposite X; concave-X removes a large X-corner hole. Border roles retain the
    named outside material. Alpha art consists of authored scattered grains/seeds,
    not transparency extracted from an opaque drawing.
    """
    data = np.zeros((size, size, 4), dtype=np.uint8)
    centers = {"NW": (0, 0), "NE": (size-1, 0), "SE": (size-1, size-1), "SW": (0, size-1)}
    opposite = {"NW": "SE", "NE": "SW", "SE": "NW", "SW": "NE"}
    for y in range(size):
        for x in range(size):
            if size == 16:
                noise = (x*17 + y*29 + x*y*3) % 19
                foreground = (182 + noise, 123 + noise//2, 52 + noise//3, 255)
                background = (34 + noise//2, 66 + noise//3, 96 + noise//4, 255)
                curve = size * .42 + ((x+y) % 3 == 0) * .25
                hole = size * .82
            else:
                noise = ((x//3)*11 + y*7 + (x ^ y)*5) % 23
                foreground = (59 + noise//2, 116 + noise, 57 + noise//3, 255)
                background = (94 + noise, 60 + noise//2, 39 + noise//4, 255)
                curve = size * .43 + ((x+2*y) % 7 == 0) * .4
                hole = size * .815
            state = role == "solid"
            if role.startswith("convex-"):
                cx, cy = centers[opposite[role[7:]]]
                state = ((x-cx)**2 + (y-cy)**2)**.5 < curve
            elif role.startswith("concave-"):
                cx, cy = centers[role[8:]]
                state = ((x-cx)**2 + (y-cy)**2)**.5 >= hole
            elif role.startswith("edge-"):
                side = role[-1]
                state = {"N": y >= size-curve, "S": y < curve,
                         "W": x >= size-curve, "E": x < curve}[side]
            if not sparse:
                data[y, x] = foreground if state else background
            elif state:
                if size == 16:
                    grain = (x % 4 in (0, 1) and y % 4 in (0, 1)) or (x+y) % 11 == 0
                    alpha = (255, 128, 254, 127, 1)[(x+2*y) % 5]
                    pigment = (222, 190 + noise, 122 + noise)
                else:
                    grain = ((x % 7 in (0, 1, 2) and y % 5 in (0, 1)) or
                             (x % 7 == 1 and y % 5 == 2) or (x*3+y) % 29 == 0)
                    alpha = (127, 255, 1, 254, 128)[(2*x+y) % 5]
                    pigment = (155 + noise, 55 + noise//2, 105 + noise)
                if grain:
                    data[y, x] = (*pigment, alpha)
            else:
                # Original hidden RGB is intentionally retained in raw artwork.
                data[y, x] = (12 + x % 9, 19 + y % 7, 33, 0)
    return Image.fromarray(data)


def source_atlas(size):
    columns, rows = (7, 5) if size == 16 else (8, 4)
    image = Image.new("RGBA", (columns*size, rows*size))
    oracle_coordinates = {}
    for mode, positions in zip(("opaque", "alpha"), PLACEMENTS[size]):
        coordinates = {}
        for role, index in zip(ROLES, positions):
            coordinates[role] = [index % columns, index // columns]
            image.paste(terrain_cell(size, role, mode == "alpha"), (index % columns*size, index // columns*size))
        oracle_coordinates[mode] = coordinates
    return image, oracle_coordinates


def source_parts(size):
    if size == 16:
        image = Image.new("RGBA", (96, 96))
        components = [("salt-cliff", "Complete salt escarpment", [0, 0, 24, 64], "tall-cliff"),
                      ("arch", "Weathered survey arch", [32, 0, 48, 32], "stamp"),
                      ("cairn", "Survey cairn", [32, 40, 32, 40], "stamp")]
        draw = ImageDraw.Draw(image)
        draw.polygon([(4, 4), (18, 3), (20, 13), (18, 55), (6, 60), (3, 46)], fill=(171, 153, 118, 255))
        for y in range(9, 57, 7):
            draw.line((5, y, 18, y-2), fill=(115, 103, 82, 255), width=2)
        draw.rectangle((36, 9, 41, 28), fill=(164, 139, 103, 255))
        draw.rectangle((70, 9, 75, 28), fill=(164, 139, 103, 255))
        draw.arc((36, 3, 75, 22), 180, 360, fill=(195, 175, 135, 255), width=5)
        for n in range(4):
            draw.ellipse((38+n*2, 69-n*7, 57-n*2, 77-n*7), fill=(129+n*12, 115+n*8, 83+n*6, 255))
    else:
        image = Image.new("RGBA", (160, 192))
        components = [("root-wall", "Full root-laced bank", [8, 8, 40, 128], "tall-cliff"),
                      ("trellis", "Orchard trellis", [64, 0, 80, 64], "stamp"),
                      ("beacon", "Woven beacon stand", [64, 80, 64, 96], "stamp")]
        draw = ImageDraw.Draw(image)
        draw.polygon([(13, 17), (41, 12), (44, 38), (37, 123), (19, 130), (12, 99)], fill=(126, 81, 46, 255))
        for y in range(27, 125, 11):
            draw.line((15, y, 40, y-6), fill=(82, 55, 37, 255), width=3)
        draw.line([(22, 17), (31, 45), (21, 65), (32, 87), (24, 123)], fill=(184, 141, 86, 255), width=3)
        for x in (70, 98, 132):
            draw.rectangle((x, 8, x+5, 59), fill=(137, 93, 53, 255))
        for y in (14, 31, 46):
            draw.line((70, y, 137, y), fill=(174, 126, 69, 255), width=4)
        draw.polygon([(91, 88), (111, 96), (116, 121), (98, 134), (77, 119), (80, 98)], fill=(201, 158, 80, 200))
        draw.line((96, 132, 96, 171), fill=(92, 64, 45, 255), width=7)
        draw.line((80, 171, 114, 171), fill=(129, 86, 45, 255), width=5)
    return image, components


def source_sprite(size):
    w, h, columns, rows = (20, 36, 3, 2) if size == 16 else (44, 28, 2, 3)
    image = Image.new("RGBA", (w*columns, h*rows))
    empty = {2, 5} if size == 16 else {1, 4}
    for index in range(columns*rows):
        if index in empty:
            continue
        x, y = index % columns*w, index // columns*h
        draw = ImageDraw.Draw(image)
        if size == 16:
            draw.line((x+9, y+9, x+9, y+30), fill=(111, 79, 43, 255), width=3)
            draw.ellipse((x+4, y+3+index%3, x+15, y+13+index%3), fill=(241, 143+index*9, 39, 128+index*20))
            draw.line((x+3, y+31, x+16, y+31), fill=(144, 107, 60, 255), width=2)
        else:
            draw.ellipse((x+5+index, y+6, x+29+index, y+20), fill=(113, 180-index*9, 171+index*7, 180))
            draw.polygon([(x+23, y+5), (x+39, y+12), (x+28, y+22)], fill=(77, 114+index*9, 150, 255))
            draw.line((x+8, y+12, x+29, y+12), fill=(187, 224, 194, 255), width=2)
    variable = [4, 0, 3] if size == 16 else [5, 0, 2]
    default = [1, 4, 0] if size == 16 else [3, 2, 5]
    animations = [{"id": "flicker" if size == 16 else "flight", "frames": [
        {"slot": f"slot-{i}", "duration_ms": duration, "timing": "supplied"} for i, duration in zip(variable, (70, 130, 40))]},
        {"id": "study", "frames": [{"slot": f"slot-{i}", "duration_ms": 100, "timing": "authoring-default"} for i in default]}]
    return image, [w, h], animations, [{"id": "still", "target": f"slot-{variable[-1]}"}]


def slots(image, geometry):
    w, h = geometry
    result = []
    for y in range(0, image.height, h):
        for x in range(0, image.width, w):
            index = y//h*(image.width//w) + x//w
            result.append({"id": f"slot-{index}", "rect": [x, y, w, h],
                           "empty": image.crop((x, y, x+w, y+h)).getchannel("A").getbbox() is None})
    return result


def fields(width, height, size):
    ground, overlay = [], []
    for y in range(height+1):
        ground.append([int((2 <= x <= width-2 and 2 <= y <= height-2 and not (x == 5 and y == 4))
                           if size == 16 else (1 <= x <= width-3 and 1 <= y <= height-1 and not (x == 3 and y in (3, 4))))
                       for x in range(width+1)])
        overlay.append([int((x in (3, 4, 7) and y in (2, 3, 6)) if size == 16 else
                            (x in (2, 3, 4, 8) and y in (2, 5, 6))) for x in range(width+1)])
    return ground, overlay


def author_fixture(destination, size, python, runtime):
    if destination.exists():
        raise ValueError(f"Exclusive artwork authorship requires an absent destination: {destination}")
    destination.mkdir(parents=True)
    pack = "saltworks" if size == 16 else "orchard"
    consumer = f"{pack}-{size}"
    terrain, art_coordinates = source_atlas(size)
    parts, components = source_parts(size)
    sprite, sprite_geometry, animations, aliases = source_sprite(size)
    images = {"terrain": terrain, "parts": parts, "sprite": sprite}
    for name, image in images.items():
        save(destination / f"originals/{name}.png", image)
    grant = "CC0-1.0: To the extent possible under law, the fixture author waives all copyright and related rights in this original procedural fixture artwork and data. No third-party source artwork was used."
    write(destination / "originals/LICENSE.txt", (grant + "\nAuthor: " + AUTHOR + "\n").encode())
    write(destination / "originals/help.txt", (f"{consumer}: independently drawn native-resolution art.\nFull source roles use inward quarter sampling, not a 5x7 recipe.\nSprite dimensions: {sprite_geometry}. Complete cliffs are manual rectangles.\n").encode())
    sketch = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">'
              f'<title>Original CC0 {pack} contour study</title><path d="M10 65 Q20 {15 if size == 16 else 30} 55 20 L100 65" fill="none" stroke="black"/></svg>\n')
    write(destination / "originals/sketch.svg", sketch.encode())
    family_names = (("ochre", "Ochre salt / blue shale", "ochre salt", "blue shale"),
                    ("grains", "Loose salt grains", "salt grains", "empty authored alpha")) if size == 16 else (
                    ("grass", "Orchard turf / loam", "orchard turf", "loam"),
                    ("seeds", "Rose seed scatter", "rose seeds", "empty authored alpha"))
    families = [{"id": names[0], "name": names[1], "source": "terrain", "foreground": names[2], "background": names[3],
                 "mode": mode, "roles": deepcopy(art_coordinates[mode])} for names, mode in zip(family_names, ("opaque", "alpha"))]
    catalog = {"schema_version": 1, "pack": pack, "families": families,
               "components": [{"id": id, "name": name, "source": "parts", "rect": rect, "kind": kind}
                              for id, name, rect, kind in components]}
    write(destination / "data/catalog.json", encoded(catalog))
    # Freeze original full cells selected by art authorship, not a terrain atlas or build output.
    frozen_families = []
    original_sha = hash_file(destination / "originals/terrain.png")
    for family, mode in zip(families, ("opaque", "alpha")):
        rows = []
        for role in ROLES:
            coordinate = art_coordinates[mode][role]
            x, y = (v*size for v in coordinate)
            crop = terrain.crop((x, y, x+size, y+size))
            path = f"references/art/{family['id']}/{role}.png"
            save(destination / path, crop)
            pixels = np.array(crop)
            pixels[pixels[:, :, 3] == 0] = 0
            rows.append({"role": role, "coordinate": coordinate, "image": path, "source_sha256": original_sha,
                         "image_sha256": hash_file(destination / path), "visible_rgba_sha256": hashlib.sha256(pixels.tobytes()).hexdigest()})
        frozen_families.append({"pack": pack, "family": family["id"], "source": "terrain", "cell_size": size,
                               "foreground": family["foreground"], "background": family["background"], "mode": mode, "roles": rows})
    write(destination / "references/frozen.json", encoded({"schema_version": 1, "author_id": AUTHOR, "families": frozen_families}))
    width, height = (12, 10) if size == 16 else (11, 9)
    ground, overlay = fields(width, height, size)
    def placement(id, kind, source, target, x, y):
        return {"id": id, "pack": pack, "kind": kind, "source": source, "target": target, "x": x, "y": y, "visible": True}
    positions = [(8, 8), (48, 16), (64, 96)] if size == 16 else [(12, 16), (88, 16), (96, 112)]
    placements = [placement(f"part-{id}", "component", "parts", id, x, y)
                  for (id, _, _, _), (x, y) in zip(components, positions)]
    placements += [placement("moving", "animation", "sprite", animations[0]["id"], 132 if size == 16 else 216, 36 if size == 16 else 28),
                   placement("default-study", "animation", "sprite", "study", 160 if size == 16 else 272, 100 if size == 16 else 168),
                   placement("static-alias", "alias", "sprite", "still", 104 if size == 16 else 256, 112 if size == 16 else 224)]
    patterns = []
    pg, pa = fields(8, 7, size)
    for family, vertices in zip(families, (pg, pa)):
        patterns.append({"id": f"{pack}-{family['id']}", "pack": pack, "family": family["id"], "width": 8, "height": 7, "vertices": vertices})
    scene = {"id": "salt-survey" if size == 16 else "orchard-flight", "width": width, "height": height,
             "layers": [{"id": "ground", "kind": "terrain", "pack": pack, "family": families[0]["id"], "vertices": ground, "visible": True},
                        {"id": "scatter", "kind": "terrain", "pack": pack, "family": families[1]["id"], "vertices": overlay, "visible": True},
                        {"id": "complete-art", "kind": "objects", "visible": True, "placements": placements}]}
    write(destination / "data/scenes.json", encoded({"schema_version": 1, "patterns": patterns, "scenes": [scene]}))
    sources = []
    for name, image in images.items():
        geometry = sprite_geometry if name == "sprite" else [size, size]
        sources.append({"id": name, "pack": pack, "path": f"originals/{name}.png", "kind": "sprite" if name == "sprite" else "atlas",
                        "frame_size": geometry, "slots": slots(image, geometry),
                        "animations": animations if name == "sprite" else [], "aliases": aliases if name == "sprite" else []})
    originals = [{"path": f"originals/{name}", "license": "cc0"} for name in ("terrain.png", "parts.png", "sprite.png", "LICENSE.txt", "help.txt", "sketch.svg")]
    manifest = {"schema_version": 1, "id": consumer, "profile": "quarter-corner-v1", "cell_size": size,
                "packs": [{"id": pack, "catalog": "data/catalog.json"}],
                "licenses": [{"id": "cc0", "path": "originals/LICENSE.txt", "spdx": "CC0-1.0", "author": AUTHOR, "grant": grant}],
                "source_roots": ["originals"], "originals": originals, "sources": sources,
                "inventory": "records/inventory.json", "frozen_reference": "references/frozen.json",
                "source_review": "reviews/source.json", "scenes": "data/scenes.json", "output_root": "outputs",
                "python_executable": str(python), "tiled_runtime": str(runtime)}
    write(destination / "manifest.json", encoded(manifest))
    write(destination / "AUTHORSHIP.txt", (f"{consumer}\n{grant}\nAuthor identity: {AUTHOR}\nNative-resolution procedural drawing, independent of all RPGW art.\nNo independent source approval is supplied. Inventory requires explicit inspect initialization.\n16px and 32px drawings are not scaled copies.\n").encode())
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--size", type=int, choices=(16, 32), required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    arguments = parser.parse_args()
    author_fixture(arguments.destination, arguments.size, arguments.python, arguments.runtime)
