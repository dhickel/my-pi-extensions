"""Frozen ORIGINAL art and consumer intent, never generated atlases as oracle.

The literal quarter table is independent of terrain.normalize and its traces.
Map placement declarations are reconstructed from consumer scene/source data,
not native IDs, native pixels, or the candidate's self-reported coverage.
"""
from __future__ import annotations

import math
import numpy as np
from PIL import Image

from .manifest import json_bytes, require, sha256
from .maps import parse_map, read_tileset, property_values, resolve_reference, xml_integer
from .pixels import animation_probes, compare_visible, premultiply, source_over, unpremultiply, byte_multiply
from .sources import image_bytes

# across, vertical, opposite, convex, vertical boundary, horizontal boundary, concave
QUARTER_TABLE = ((1, 3, 2, "convex-SE", "edge-E", "edge-S", "concave-SE"),
                 (0, 2, 3, "convex-SW", "edge-W", "edge-S", "concave-SW"),
                 (3, 1, 0, "convex-NW", "edge-W", "edge-N", "concave-NW"),
                 (2, 0, 1, "convex-NE", "edge-E", "edge-N", "concave-NE"))


def original_patterns(roles, size, mode):
    half = size//2
    positions = ((0, 0), (half, 0), (half, half), (0, half))
    output = {}
    for mask in range(16):
        if mask == 0 and mode == "alpha":
            continue
        if mask in (0, 15):
            output[mask] = roles["solid" if mask else "background"].copy()
            continue
        picture = Image.new("RGBA", (size, size))
        for corner, (across, vertical, diagonal, convex, v_edge, h_edge, concave) in enumerate(QUARTER_TABLE):
            if not mask & (1 << corner):
                name, quarter = "background", (corner+2)%4
            elif mask & (1 << across) and mask & (1 << vertical):
                name = "solid" if mask & (1 << diagonal) else concave
                quarter = (corner+2)%4 if name == "solid" else corner
            elif mask & (1 << across):
                name, quarter = h_edge, corner
            elif mask & (1 << vertical):
                name, quarter = v_edge, corner
            else:
                name, quarter = convex, corner
            x, y = positions[quarter]
            picture.paste(roles[name].crop((x, y, x+half, y+half)), positions[corner])
        output[mask] = picture
    return output


def intent_masks(field):
    return [[field[y][x] + 2*field[y][x+1] + 4*field[y+1][x+1] + 8*field[y+1][x]
             for x in range(len(field[0])-1)] for y in range(len(field)-1)]


def elapsed_frame(durations, elapsed):
    """Literal strict-greater-than interpreter, independent of frame_index_at."""
    index = 0
    while elapsed > durations[index]:
        elapsed -= durations[index]
        index = (index+1)%len(durations)
    return index


def _asset(tsx, images, **values):
    return {"tsx": tsx, "images": images, "capacity": max(images)+1, "animations": {}, **values}


def original_assets(inputs, manifest, directory, sources, catalogs, frozen):
    registrations, terrains, parts = {}, {}, {}
    n = manifest["cell_size"]
    for source in sources.values():
        path = f"{directory}/tilesets/sources/{source['id']}.tsx"
        sheet = source["image"]
        w, h = source["frame_size"]
        images, static, aliases, animated, animations = {}, {}, {}, {}, {}
        slots = {s["id"]: s for s in source["slots"] if not s["empty"]}
        if source["kind"] == "atlas":
            for slot in source["slots"]:
                x, y, sw, sh = slot["rect"]
                local = y//h*(sheet.width//w)+x//w
                images[local] = sheet.crop((x, y, x+sw, y+sh))
                if not slot["empty"]:
                    static[slot["id"]] = local
        else:
            for slot in slots.values():
                local = len(images)
                static[slot["id"]] = local
                x, y, sw, sh = slot["rect"]
                images[local] = sheet.crop((x, y, x+sw, y+sh))
            for alias in source["aliases"]:
                local = len(images)
                aliases[alias["id"]] = local
                images[local] = images[static[alias["target"]]].copy()
            for animation in source["animations"]:
                local = len(images)
                animated[animation["id"]] = local
                ids = [static[f["slot"]] for f in animation["frames"]]
                animations[local] = {"ids": ids, "durations": [f["duration_ms"] for f in animation["frames"]]}
                images[local] = images[ids[0]].copy()
        a = _asset(path, images, static=static, aliases=aliases, animated=animated, animations=animations, source=source)
        registrations[source["id"]] = a
        parsed = read_tileset(inputs.root, path)
        require(parsed["animations"] == animations, "Original ordered animation declaration differs from TSX")
        node = parsed["xml"]
        if source["kind"] == "sprite":
            expected_slots = {local: slots[slot] for slot, local in static.items()}
            expected_slots.update({aliases[alias["id"]]: slots[alias["target"]] for alias in source["aliases"]})
            expected_slots.update({animated[anim["id"]]: slots[anim["frames"][0]["slot"]] for anim in source["animations"]})
            for local, slot in expected_slots.items():
                require(parsed["rectangles"][local] == {"path": source["path"], "rect": slot["rect"]}, "TSX partial/wrong original frame rectangle")
        else:
            require(resolve_reference(inputs.root, path, node.find("image").get("source")) == source["path"], "Wrong original source atlas reference")
    for pack, catalog in catalogs.items():
        for family in catalog["families"]:
            entry = frozen[(pack, family["id"])]
            roles = {r["role"]: image_bytes(inputs.read(r["image"]), r["image"]) for r in entry["roles"]}
            pictures = original_patterns(roles, n, family["mode"])
            ids = {m: None if m == 0 and family["mode"] == "alpha" else m if family["mode"] == "opaque" else m-1 for m in range(16)}
            path = f"{directory}/tilesets/terrain/{pack}-{family['id']}.tsx"
            a = _asset(path, {ids[m]: p for m, p in pictures.items()}, family=family, pack=pack,
                       mask_ids=ids, patterns=pictures, roles=roles)
            terrains[(pack, family["id"])] = a
            node = read_tileset(inputs.root, path)["xml"]
            sets = node.findall("wangsets/wangset")
            require(len(sets) == 1 and sets[0].get("type") == "corner" and sets[0].get("name") == family["name"], "Wrong native terrain identity")
            b = 2 if family["mode"] == "opaque" else 0
            expected = {ids[m]: [0, 1 if m&2 else b, 0, 1 if m&4 else b, 0, 1 if m&8 else b, 0, 1 if m&1 else b] for m in pictures}
            rows = sets[0].findall("wangtile")
            require(len(rows) == len(expected) and {xml_integer(r, "tileid"): [int(v) for v in r.get("wangid").split(",")] for r in rows} == expected,
                    "Missing/duplicate/wrong native Wang candidates")
            colors = sets[0].findall("wangcolor")
            require([c.get("name") for c in colors] == [family["foreground"]]+([family["background"]] if b else []), "Native material colors differ")
        if catalog["components"]:
            images, ids = {}, {}
            path = f"{directory}/tilesets/parts/{pack}.tsx"
            for local, part in enumerate(catalog["components"]):
                x, y, w, h = part["rect"]
                images[local] = sources[part["source"]]["image"].crop((x, y, x+w, y+h))
                ids[part["id"]] = local
            parts[pack] = _asset(path, images, ids=ids)
    all_assets = {a["tsx"]: a for a in [*registrations.values(), *terrains.values(), *parts.values()]}
    for path, a in all_assets.items():
        parsed = read_tileset(inputs.root, path)
        require(parsed["capacity"] == a["capacity"] and set(parsed["images"]) == set(a["images"]), "Original registration inventory differs")
        for local, picture in a["images"].items():
            compare_visible(picture, parsed["images"][local], f"{path}/{local}: ORIGINAL full geometry/art")
    return registrations, terrains, parts


def _primitive(a, local, x, y, entity):
    return {"asset": a, "local": local, "x": x, "y": y, "entity": entity}


def _objects(name, items):
    return {"kind": "objects", "name": name, "items": items}


def _field(name, field, a, entity):
    return {"kind": "terrain", "name": name, "field": field, "asset": a, "entity": entity}


def _gallery(path, kind, items, size):
    sw = max(a["images"][local].width for a, local, _ in items)+2*size
    sh = max(a["images"][local].height for a, local, _ in items)+2*size
    columns = min(6, len(items))
    width = math.ceil((columns*sw+size)/size)
    height = math.ceil((math.ceil(len(items)/columns)*sh+size)/size)
    placed = [_primitive(a, local, size+i%columns*sw, size+i//columns*sh, entity) for i, (a, local, entity) in enumerate(items)]
    return {"path": path, "kind": kind, "width": width, "height": height, "layers": [_objects(kind, placed)]}


def descriptions(manifest, directory, catalogs, scene_doc, registrations, terrains, parts):
    """Expected whole-map intent; changes in generated XML cannot change this list."""
    size, result = manifest["cell_size"], []
    for pack in catalogs:
        items = []
        for sid, a in registrations.items():
            if a["source"]["pack"] == pack:
                items += [(a, local, f"{sid}:frame:{slot}") for slot, local in a["static"].items()]
                items += [(a, local, f"{sid}:alias:{alias}") for alias, local in a["aliases"].items()]
        result.append(_gallery(f"{directory}/maps/inventory/{pack}.tmx", "source-inventory", items, size))
        items = [(a, local, f"{sid}:animation:{name}") for sid, a in registrations.items() if a["source"]["pack"] == pack for name, local in a["animated"].items()]
        if items:
            result.append(_gallery(f"{directory}/maps/playback/{pack}.tmx", "playback", items, size))
        items = [(a, local, f"{p}:{family}:mask:{mask}") for (p, family), a in terrains.items() if p == pack for mask, local in a["mask_ids"].items() if local is not None]
        result.append(_gallery(f"{directory}/maps/terrain/{pack}.tmx", "terrain-masks", items, size))
        if pack in parts:
            a = parts[pack]
            result.append(_gallery(f"{directory}/maps/parts/{pack}.tmx", "complete-parts", [(a, local, f"{pack}:component:{name}") for name, local in a["ids"].items()], size))
    for pattern in scene_doc["patterns"]:
        a = terrains[(pattern["pack"], pattern["family"])]
        layers = []
        if a["family"]["mode"] == "alpha":
            ground = next(g for (p, _), g in terrains.items() if p == pattern["pack"] and g["family"]["mode"] == "opaque")
            layers.append(_field("ground-context", [[0]*(pattern["width"]+1) for _ in range(pattern["height"]+1)], ground, "layer:ground-context"))
        layers.append(_field(pattern["id"], pattern["vertices"], a, f"pattern:{pattern['id']}"))
        result.append({"path": f"{directory}/maps/patterns/{pattern['id']}.tmx", "kind": "terrain-pattern", "width": pattern["width"], "height": pattern["height"], "layers": layers})
    for scene in scene_doc["scenes"]:
        layers = []
        for layer in scene["layers"]:
            if layer["kind"] == "terrain":
                layers.append(_field(layer["id"], layer["vertices"], terrains[(layer["pack"], layer["family"])], f"layer:{layer['id']}"))
            else:
                items = []
                for p in layer["placements"]:
                    a = parts[p["pack"]] if p["kind"] == "component" else registrations[p["source"]]
                    table = {"component": "ids", "frame": "static", "alias": "aliases", "animation": "animated"}[p["kind"]]
                    items.append(_primitive(a, a[table][p["target"]], p["x"], p["y"], p["id"]))
                layers.append(_objects(layer["id"], items))
        result.append({"path": f"{directory}/maps/scenes/{scene['id']}.tmx", "kind": "scene", "width": scene["width"], "height": scene["height"], "layers": layers})
    return result


def primitives(description, size):
    result = []
    for layer in description["layers"]:
        if layer["kind"] == "objects":
            result += layer["items"]
        else:
            a = layer["asset"]
            for y, row in enumerate(intent_masks(layer["field"])):
                for x, mask in enumerate(row):
                    local = a["mask_ids"][mask]
                    if local is not None:
                        result.append(_primitive(a, local, x*size, y*size, layer["entity"]))
    return result


def declaration(description):
    """Serializable expected recipe identity, excludes live PIL objects."""
    layers = []
    for layer in description["layers"]:
        if layer["kind"] == "objects":
            layers.append({**layer, "items": [{**p, "asset": p["asset"]["tsx"]} for p in layer["items"]]})
        else:
            layers.append({**layer, "asset": layer["asset"]["tsx"]})
    return {**description, "layers": layers}


def verify_map(root, description, size):
    graph = parse_map(root, description["path"], size)
    node = graph["xml"]
    require(graph["size"] == [description["width"]*size, description["height"]*size], "Original intent/map dimensions differ")
    refs = {}
    for layer in description["layers"]:
        assets = [p["asset"] for p in layer["items"]] if layer["kind"] == "objects" else [layer["asset"]]
        for a in assets:
            refs[a["tsx"]] = a
    first, gids, expected_refs = 1, {}, []
    for a in refs.values():
        gids[a["tsx"]] = first
        expected_refs.append((first, first+a["capacity"], a["tsx"]))
        first += a["capacity"]
    require(graph["ranges"] == expected_refs, "Original intent external TSX identity/GID range differs")
    layers = [n for n in node if n.tag in ("layer", "group", "objectgroup")]
    require(len(layers) == len(description["layers"]), "Missing/extra native layer")
    for actual, layer in zip(layers, description["layers"]):
        require(actual.get("name") == layer["name"] and actual.get("visible", "1") == "1" and actual.get("opacity", "1") == "1", "Hidden/wrong intent layer")
        if layer["kind"] == "terrain":
            a = layer["asset"]
            expected = [0 if a["mask_ids"][m] is None else gids[a["tsx"]]+a["mask_ids"][m] for row in intent_masks(layer["field"]) for m in row]
            require(actual.tag == "layer" and [int(v) for v in actual.find("data").text.split(",")] == expected, "Native cells/flags do not implement independent field")
        else:
            objects = actual.findall("object")
            require(actual.tag == "objectgroup" and actual.get("draworder") == "index" and len(objects) == len(layer["items"]), "Original complete placements/draw order differ")
            for obj, p in zip(objects, layer["items"]):
                picture = p["asset"]["images"][p["local"]]
                expected = [gids[p["asset"]["tsx"]]+p["local"], p["x"], p["y"]+picture.height, picture.width, picture.height]
                require([xml_integer(obj, k) for k in ("gid", "x", "y", "width", "height")] == expected
                        and obj.get("name") == p["entity"] and property_values(obj).get("entity") == p["entity"], "Native placement/source/whole geometry differs from original intent")
    return primitives(description, size)


def selected(p, elapsed):
    a, local = p["asset"], p["local"]
    animation = a["animations"].get(local)
    if animation:
        local = animation["ids"][elapsed_frame(animation["durations"], elapsed)]
    return a["images"][local]


def reconstruct(description, size, elapsed=0):
    canvas = np.zeros((description["height"]*size, description["width"]*size, 4), dtype=np.uint8)
    ps = primitives(description, size)
    for p in ps:
        source = premultiply(selected(p, elapsed))
        x, y = p["x"], p["y"]
        require(0 <= x and 0 <= y and x+source.shape[1] <= canvas.shape[1] and y+source.shape[0] <= canvas.shape[0], "Original complete placement clipped")
        region = canvas[y:y+source.shape[0], x:x+source.shape[1]]
        region[:] = source_over(region, source)
    transmittance = np.full(canvas.shape[:2], 255, dtype=np.uint8)
    visible = {p["entity"]: 0 for p in ps}
    for p in reversed(ps):
        alpha = np.asarray(selected(p, elapsed))[:, :, 3]
        x, y = p["x"], p["y"]
        region = transmittance[y:y+alpha.shape[0], x:x+alpha.shape[1]]
        visible[p["entity"]] += int(np.count_nonzero(byte_multiply(alpha, region)))
        region[:] = byte_multiply(region, 255-alpha)
    require(all(visible.values()), "Fully occluded required ORIGINAL art")
    return canvas, visible


def draw_pixels(field, patterns, size, ground=None):
    height, width = len(field)-1, len(field[0])-1
    canvas = np.zeros((height*size, width*size, 4), dtype=np.uint8)
    if ground is not None:
        data = premultiply(ground)
        for y in range(height):
            for x in range(width):
                canvas[y*size:(y+1)*size, x*size:(x+1)*size] = data
    buffers = {mask: premultiply(image) for mask, image in patterns.items()}
    for y, row in enumerate(intent_masks(field)):
        for x, mask in enumerate(row):
            if mask not in buffers:
                continue
            source = buffers[mask]
            region = canvas[y*size:(y+1)*size, x*size:(x+1)*size]
            region[:] = source_over(region, source)
    return canvas


def times(description, size):
    result = {0}
    for p in primitives(description, size):
        animation = p["asset"]["animations"].get(p["local"])
        if animation:
            result.update(animation_probes(animation["durations"]))
    return sorted(result)
