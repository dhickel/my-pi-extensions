"""External registrations, complete editable galleries/scenes, guarded stable candidates."""
from __future__ import annotations

import math
import os
from pathlib import Path, PurePosixPath
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image, ImageDraw

from .manifest import (array, boolean, closed, identifier, integer, json_bytes, pair,
                       relative_path, require, sha256, unique)
from .pixels import (animation_probes, byte_multiply, frame_index_at, premultiply,
                     source_over, unpremultiply)
from .source_geometry import check_source_geometry
from .sources import (capabilities, checker, context_image, current_inventory, image_bytes,
                      load_catalogs, load_frozen, load_sources, png_bytes, tool_identity,
                      validate_inventory)
from .terrain import corner_id, field_masks, normalize


def relative(owner, target):
    return Path(os.path.relpath(target, PurePosixPath(owner).parent)).as_posix()


def write_xml(root, path, node):
    ET.indent(node, space="  ")
    root.write(path, ET.tostring(node, encoding="utf-8", xml_declaration=True) + b"\n")


def properties(node, values):
    parent = ET.SubElement(node, "properties")
    for key, value in values.items():
        kind = "bool" if type(value) is bool else "int" if type(value) is int else "string"
        ET.SubElement(parent, "property", name=key, type=kind,
                      value=str(value).lower() if type(value) is bool else str(value))


def property_values(node):
    rows = node.findall("properties/property")
    unique([r.get("name") for r in rows], "XML properties")
    return {r.get("name"): r.get("value", "") for r in rows}


def tileset(name, width, height, count, columns):
    node = ET.Element("tileset", version="1.10", tiledversion="1.12.2", name=name,
                      tilewidth=str(width), tileheight=str(height), tilecount=str(count),
                      columns=str(columns), objectalignment="bottomleft", tilerendersize="tile")
    ET.SubElement(node, "transformations", hflip="0", vflip="0", rotate="0", preferuntransformed="1")
    return node


def add_source_image(node, owner, source):
    ET.SubElement(node, "image", source=relative(owner, source["path"]),
                  width=str(source["image"].width), height=str(source["image"].height))


def register_source(root, directory, source, license_path):
    path = f"{directory}/tilesets/sources/{source['id']}.tsx"
    w, h = source["frame_size"]
    images, static, aliases, animated, animations = {}, {}, {}, {}, {}
    if source["kind"] == "atlas":
        columns = source["image"].width // w
        node = tileset(source["id"], w, h, len(source["slots"]), columns)
        add_source_image(node, path, source)
        for slot in source["slots"]:
            x, y, _, _ = slot["rect"]
            local = (y // h) * columns + x // w
            images[local] = source["image"].crop((x, y, x+w, y+h))
            if not slot["empty"]:
                static[slot["id"]] = local
    else:
        usable = [s for s in source["slots"] if not s["empty"]]
        count = len(usable) + len(source["aliases"]) + len(source["animations"])
        node = tileset(source["id"], w, h, count, 0)
        by_slot = {s["id"]: s for s in usable}

        def add_frame(local, slot, values):
            x, y, fw, fh = slot["rect"]
            tile = ET.SubElement(node, "tile", id=str(local), x=str(x), y=str(y), width=str(fw), height=str(fh))
            properties(tile, {"source_slot": slot["id"], "source_rect": ",".join(map(str, slot["rect"])), **values})
            add_source_image(tile, path, source)
            images[local] = source["image"].crop((x, y, x+fw, y+fh))
            return tile

        for local, slot in enumerate(usable):
            static[slot["id"]] = local
            add_frame(local, slot, {"role": "static-frame"})
        for alias in source["aliases"]:
            local = len(images)
            aliases[alias["id"]] = local
            add_frame(local, by_slot[alias["target"]], {"role": "alias", "alias_of": static[alias["target"]]})
        for animation in source["animations"]:
            local = len(images)
            animated[animation["id"]] = local
            tile = add_frame(local, by_slot[animation["frames"][0]["slot"]], {"role": "animation", "animation_id": animation["id"]})
            frames = ET.SubElement(tile, "animation")
            for frame in animation["frames"]:
                ET.SubElement(frames, "frame", tileid=str(static[frame["slot"]]), duration=str(frame["duration_ms"]))
            animations[local] = {"ids": [static[f["slot"]] for f in animation["frames"]],
                                 "durations": [f["duration_ms"] for f in animation["frames"]]}
    properties(node, {"kind": f"source-{source['kind']}", "source_image": relative(path, source["path"]),
                      "source_license": relative(path, license_path), "source_sha256": source["sha256"],
                      "timing": "Supplied durations preserved; authoring-default durations are explicit 100ms, not source-rate inference."})
    write_xml(root, path, node)
    return {"tsx": path, "images": images, "static": static, "aliases": aliases,
            "animated": animated, "animations": animations, "capacity": max(images)+1, "source": source}


def register_terrain(root, directory, pack, family, source, size):
    candidates, traces = normalize(source["image"], family, size)
    mask_ids = {mask: (None if mask not in candidates else list(candidates).index(mask)) for mask in range(16)}
    columns = 4 if family["mode"] == "opaque" else 5
    rows = len(candidates) // columns
    atlas = Image.new("RGBA", (columns*size, rows*size))
    tsx = f"{directory}/tilesets/terrain/{pack}-{family['id']}.tsx"
    atlas_path = tsx[:-4] + ".png"
    node = tileset(f"{pack}-{family['id']}", size, size, len(candidates), columns)
    images = {}
    for mask, image in candidates.items():
        local = mask_ids[mask]
        atlas.paste(image, (local % columns * size, local // columns * size))
        images[local] = image
    root.write(atlas_path, png_bytes(atlas))
    ET.SubElement(node, "image", source=relative(tsx, atlas_path), width=str(atlas.width), height=str(atlas.height))
    properties(node, {"kind": "terrain", "pack": pack, "family": family["id"], "mode": family["mode"],
                      "source_image": relative(tsx, source["path"]), "source_sha256": source["sha256"],
                      "mask_registry": ";".join(f"{m}:{'null' if t is None else t}" for m, t in mask_ids.items()),
                      "background_color": 2 if family["mode"] == "opaque" else 0})
    sets = ET.SubElement(node, "wangsets")
    wangset = ET.SubElement(sets, "wangset", name=family["name"], type="corner", tile=str(mask_ids[15]))
    materials = [(family["foreground"], 15)] + ([(family["background"], 0)] if family["mode"] == "opaque" else [])
    for name, mask in materials:
        values = np.asarray(candidates[mask])
        visible = values[values[:, :, 3] > 0, :3]
        median = np.median(visible, axis=0).astype(np.uint8)
        color = "#" + "".join(f"{v:02x}" for v in median)
        ET.SubElement(wangset, "wangcolor", name=name, color=color, tile=str(mask_ids[mask]), probability="1")
    for mask in candidates:
        ET.SubElement(wangset, "wangtile", tileid=str(mask_ids[mask]), wangid=",".join(map(str, corner_id(mask, family["mode"]))))
    write_xml(root, tsx, node)
    return {"tsx": tsx, "images": images, "capacity": len(images), "animations": {}, "mask_ids": mask_ids,
            "family": family, "atlas": atlas_path, "traces": traces}


def register_parts(root, directory, pack, catalog, sources):
    if not catalog["components"]:
        return None
    parts = catalog["components"]
    path = f"{directory}/tilesets/parts/{pack}.tsx"
    node = tileset(f"{pack}-complete-parts", max(p["rect"][2] for p in parts),
                   max(p["rect"][3] for p in parts), len(parts), 0)
    properties(node, {"kind": "complete-parts", "pack": pack})
    images, ids = {}, {}
    for local, part in enumerate(parts):
        x, y, w, h = part["rect"]
        source = sources[part["source"]]
        image = source["image"].crop((x, y, x+w, y+h))
        image_path = f"{directory}/tilesets/parts/{pack}/{part['id']}.png"
        root.write(image_path, png_bytes(image))
        tile = ET.SubElement(node, "tile", id=str(local))
        properties(tile, {"component_id": part["id"], "source_image": relative(path, source["path"]),
                          "source_sha256": source["sha256"], "source_rect": ",".join(map(str, part["rect"])),
                          "placement": "Complete unscaled manual stamp, bottom-left object anchor", "kind": part["kind"]})
        ET.SubElement(tile, "image", source=relative(path, image_path), width=str(w), height=str(h))
        images[local], ids[part["id"]] = image, local
    write_xml(root, path, node)
    return {"tsx": path, "images": images, "capacity": len(images), "animations": {}, "ids": ids}


def map_root(width, height, size, references, path):
    node = ET.Element("map", version="1.10", tiledversion="1.12.2", orientation="orthogonal",
                      renderorder="right-down", width=str(width), height=str(height),
                      tilewidth=str(size), tileheight=str(size), infinite="0")
    firstgids, first = {}, 1
    for asset in references:
        require(asset["tsx"] not in firstgids, "Duplicate map tileset")
        ET.SubElement(node, "tileset", firstgid=str(first), source=relative(path, asset["tsx"]))
        firstgids[asset["tsx"]] = first
        first += asset["capacity"]
    return node, firstgids


def add_layer(node, name, cells, width, height, values):
    layer = ET.SubElement(node, "layer", id=str(len([n for n in node if n.tag in ("layer", "objectgroup")])+1),
                          name=name, width=str(width), height=str(height), visible="1", opacity="1")
    properties(layer, values)
    require(len(cells) == width*height, "Truncated layer")
    data = ET.SubElement(layer, "data", encoding="csv")
    data.text = "\n" + ",\n".join(",".join(map(str, cells[y*width:(y+1)*width])) for y in range(height)) + "\n"
    return layer


def add_objects(node, name, items, firstgids):
    group = ET.SubElement(node, "objectgroup", id=str(len([n for n in node if n.tag in ("layer", "objectgroup")])+1),
                          name=name, draworder="index", visible="1", opacity="1")
    next_id = len(node.findall(".//object"))+1
    for index, item in enumerate(items, next_id):
        asset, local = item["asset"], item["tile"]
        image = asset["images"][local]
        obj = ET.SubElement(group, "object", id=str(index), name=item["entity"],
                            gid=str(firstgids[asset["tsx"]]+local), x=str(item["x"]), y=str(item["y"]+image.height),
                            width=str(image.width), height=str(image.height), visible="1", rotation="0")
        properties(obj, {"entity": item["entity"], "complete_artwork": True})
    return group


def finalize_map(root, path, node):
    layers = [n for n in node.iter() if n.tag in ("group", "layer", "objectgroup")]
    objects = node.findall(".//object")
    node.set("nextlayerid", str(max((int(n.get("id")) for n in layers), default=0)+1))
    node.set("nextobjectid", str(max((int(n.get("id")) for n in objects), default=0)+1))
    write_xml(root, path, node)


def gallery_map(root, path, kind, items, size):
    require(bool(items), f"Empty {kind} gallery")
    max_w = max(i["asset"]["images"][i["tile"]].width for i in items)
    max_h = max(i["asset"]["images"][i["tile"]].height for i in items)
    stride_w, stride_h = max_w+size*2, max_h+size*2
    columns = min(6, len(items))
    width = math.ceil((columns*stride_w+size) / size)
    height = math.ceil((math.ceil(len(items)/columns)*stride_h+size) / size)
    references = list({i["asset"]["tsx"]: i["asset"] for i in items}.values())
    node, firstgids = map_root(width, height, size, references, path)
    properties(node, {"gallery_kind": kind})
    placements = [{**item, "x": size+index%columns*stride_w, "y": size+index//columns*stride_h}
                  for index, item in enumerate(items)]
    add_objects(node, kind, placements, firstgids)
    finalize_map(root, path, node)
    return {"path": path, "kind": kind, "entities": [i["entity"] for i in items], "dimensions": [width, height]}


def load_scenes(inputs, manifest, catalogs, sources):
    doc = closed(inputs.json(manifest["scenes"]), ("schema_version", "patterns", "scenes"), "scene inputs")
    require(type(doc["schema_version"]) is int and doc["schema_version"] == 1, "Unsupported scene version")
    families = {(pack, f["id"]): f for pack, cat in catalogs.items() for f in cat["families"]}

    def dimensions(width, height, vertices=None):
        integer(width, "finite map width", 1)
        integer(height, "finite map height", 1)
        if vertices is not None:
            masks = field_masks(vertices)
            require(len(masks) == height and len(masks[0]) == width, "Finite vertex field dimensions disagree")

    seen = []
    for pattern in array(doc["patterns"], "terrain patterns", True):
        closed(pattern, ("id", "pack", "family", "width", "height", "vertices"), "terrain pattern")
        identifier(pattern["id"], "pattern id")
        key = pattern["pack"], pattern["family"]
        require(key in families, "Pattern references unknown family")
        seen.append(key)
        dimensions(pattern["width"], pattern["height"], pattern["vertices"])
        require(len({m for row in field_masks(pattern["vertices"]) for m in row}) >= 4,
                "Terrain pattern must demonstrate connected material variation")
    unique([p["id"] for p in doc["patterns"]], "pattern ids")
    require(set(seen) == set(families), "Terrain pattern gallery must cover every family")
    unique(seen, "family patterns")
    for scene in array(doc["scenes"], "consumer scenes", True):
        closed(scene, ("id", "width", "height", "layers"), "scene")
        identifier(scene["id"], "scene id")
        dimensions(scene["width"], scene["height"])
        terrain_seen = []
        placement_ids = []
        for layer in array(scene["layers"], "ordered scene layers", True):
            require(type(layer) is dict and layer.get("kind") in ("terrain", "objects"), "Unknown scene layer kind")
            if layer["kind"] == "terrain":
                closed(layer, ("id", "kind", "pack", "family", "vertices", "visible"), "terrain layer")
                key = layer["pack"], layer["family"]
                require(key in families, "Scene references unknown material family")
                terrain_seen.append(key)
                dimensions(scene["width"], scene["height"], layer["vertices"])
                require(len({m for row in field_masks(layer["vertices"]) for m in row}) >= 4,
                        "Scene material field lacks authored variation")
            else:
                closed(layer, ("id", "kind", "visible", "placements"), "object layer")
                for placement in array(layer["placements"], "placements", True):
                    closed(placement, ("id", "pack", "kind", "source", "target", "x", "y", "visible"), "placement")
                    identifier(placement["id"], "placement id")
                    placement_ids.append(placement["id"])
                    require(placement["pack"] in catalogs and placement["source"] in sources
                            and sources[placement["source"]]["pack"] == placement["pack"], "Unknown placement pack/source")
                    identifier(placement["target"], "placement target")
                    require(placement["kind"] in ("component", "frame", "animation", "alias"), "Unknown placement kind")
                    integer(placement["x"], "placement x")
                    integer(placement["y"], "placement y")
                    boolean(placement["visible"], "placement visibility")
                    require(placement["visible"], "Hidden required scene placement")
            identifier(layer["id"], "layer id")
            boolean(layer["visible"], "layer visibility")
            require(layer["visible"], "Hidden required scene layer")
        unique([l["id"] for l in scene["layers"]], "scene layer ids")
        unique(placement_ids, "scene placement ids")
        unique(terrain_seen, "scene material layers")
        require(any(families[key]["mode"] == "opaque" for key in terrain_seen), "Scene lacks initialized opaque ground")
        require(scene["layers"][0]["kind"] == "terrain"
                and families[(scene["layers"][0]["pack"], scene["layers"][0]["family"])]["mode"] == "opaque",
                "Scene draw order must begin with an opaque material layer")
        require(bool(placement_ids), "Scene lacks complete placed artwork")
    unique([s["id"] for s in doc["scenes"]], "scene ids")
    return doc


def terrain_cells(vertices, asset, firstgid):
    return [0 if asset["mask_ids"][mask] is None else firstgid+asset["mask_ids"][mask]
            for row in field_masks(vertices) for mask in row]


def pattern_map(root, directory, pattern, terrains, size):
    path = f"{directory}/maps/patterns/{pattern['id']}.tmx"
    key = pattern["pack"], pattern["family"]
    asset = terrains[key]
    references = [asset]
    ground = None
    if asset["family"]["mode"] == "alpha":
        ground = next((a for (pack, _), a in terrains.items() if pack == pattern["pack"] and a["family"]["mode"] == "opaque"), None)
        require(ground is not None, "Alpha pattern needs consumer-authored opaque ground context")
        references.insert(0, ground)
    width, height = pattern["width"], pattern["height"]
    node, firstgids = map_root(width, height, size, references, path)
    properties(node, {"gallery_kind": "terrain-pattern", "pattern_id": pattern["id"]})
    entities = []
    if ground:
        name = "ground-context"
        entities.append(f"layer:{name}")
        add_layer(node, name, [firstgids[ground["tsx"]]+ground["mask_ids"][0]]*(width*height), width, height, {"entity": f"layer:{name}"})
    entity = f"pattern:{pattern['id']}"
    add_layer(node, pattern["id"], terrain_cells(pattern["vertices"], asset, firstgids[asset["tsx"]]), width, height,
              {"entity": entity, "family": pattern["family"], "pack": pattern["pack"], "mode": asset["family"]["mode"]})
    entities.append(entity)
    finalize_map(root, path, node)
    return {"path": path, "kind": "terrain-pattern", "entities": entities, "dimensions": [width, height],
            "intent_vertices": pattern["vertices"]}


def scene_map(root, directory, scene, terrains, registrations, parts, catalogs, size):
    path = f"{directory}/maps/scenes/{scene['id']}.tmx"
    references, items_by_layer = {}, {}
    entities = []
    for layer in scene["layers"]:
        if layer["kind"] == "terrain":
            asset = terrains[(layer["pack"], layer["family"])]
            references[asset["tsx"]] = asset
            entities.append(f"layer:{layer['id']}")
        else:
            items = []
            for placement in layer["placements"]:
                if placement["kind"] == "component":
                    asset = parts.get(placement["pack"])
                    require(asset is not None and placement["target"] in asset["ids"], "Unknown complete component placement")
                    part = next(p for p in catalogs[placement["pack"]]["components"] if p["id"] == placement["target"])
                    require(part["source"] == placement["source"], "Component placement source mismatch")
                    local = asset["ids"][placement["target"]]
                else:
                    asset = registrations[placement["source"]]
                    table = {"frame": "static", "animation": "animated", "alias": "aliases"}[placement["kind"]]
                    require(placement["target"] in asset[table], "Placement targets unknown/empty frame, animation, or alias")
                    local = asset[table][placement["target"]]
                references[asset["tsx"]] = asset
                items.append({"asset": asset, "tile": local, "x": placement["x"], "y": placement["y"], "entity": placement["id"]})
                entities.append(placement["id"])
            items_by_layer[layer["id"]] = items
    node, firstgids = map_root(scene["width"], scene["height"], size, list(references.values()), path)
    properties(node, {"gallery_kind": "scene", "scene_id": scene["id"]})
    for layer in scene["layers"]:
        if layer["kind"] == "terrain":
            asset = terrains[(layer["pack"], layer["family"])]
            add_layer(node, layer["id"], terrain_cells(layer["vertices"], asset, firstgids[asset["tsx"]]),
                      scene["width"], scene["height"], {"entity": f"layer:{layer['id']}", "family": layer["family"],
                      "pack": layer["pack"], "mode": asset["family"]["mode"]})
        else:
            add_objects(node, layer["id"], items_by_layer[layer["id"]], firstgids)
    finalize_map(root, path, node)
    return {"path": path, "kind": "scene", "entities": entities, "dimensions": [scene["width"], scene["height"]],
            "intent_sha256": sha256(json_bytes(scene))}


def resolve_reference(root, owner, value):
    require(type(value) is str and value and not PurePosixPath(value).is_absolute()
            and not any(c in value for c in ("\\", ":", "\0")), "Non-relative external reference")
    target = Path(os.path.normpath(root.path / PurePosixPath(owner).parent / value))
    require(target.is_relative_to(root.path), "External reference escapes consumer")
    relative = target.relative_to(root.path).as_posix()
    root.check_path(relative)
    require(root.exists(relative), f"Missing external reference: {value}")
    return relative


def xml_integer(node, key, default=None, minimum=0):
    value = node.get(key, default)
    require(value is not None, f"Missing XML {key}")
    try:
        number = float(value)
        require(math.isfinite(number) and number.is_integer(), f"Nonintegral XML {key}")
        return integer(int(number), f"XML {key}", minimum)
    except (ValueError, OverflowError) as error:
        raise ValueError(f"Invalid XML integer {key}: {value}") from error


def read_tileset(root, path):
    node = ET.fromstring(root.read(path)[0])
    require(node.tag == "tileset" and node.get("objectalignment") == "bottomleft", "Wrong external tileset/alignment")
    transform = node.find("transformations")
    require(transform is not None and all(transform.get(k) == "0" for k in ("hflip", "vflip", "rotate")), "Enabled art transformation")
    count, columns = xml_integer(node, "tilecount", minimum=1), xml_integer(node, "columns")
    w, h = xml_integer(node, "tilewidth", minimum=1), xml_integer(node, "tileheight", minimum=1)
    images, animations, rectangles = {}, {}, {}

    def opened_image(image_node):
        require(image_node is not None and image_node.get("trans") is None, "Missing image or manufactured transparency")
        path_image = resolve_reference(root, path, image_node.get("source"))
        image = image_bytes(root.read(path_image)[0], path_image)
        require(image.size == (xml_integer(image_node, "width", minimum=1), xml_integer(image_node, "height", minimum=1)), "External image dimensions")
        return image, path_image

    direct = node.find("image")
    if direct is not None:
        source, source_path = opened_image(direct)
        require(columns > 0 and source.width == columns*w and source.height % h == 0
                and count == columns*(source.height//h), "Atlas geometry/capacity mismatch")
        for local in range(count):
            x, y = local % columns*w, local // columns*h
            images[local] = source.crop((x, y, x+w, y+h))
            rectangles[local] = {"path": source_path, "rect": [x, y, w, h]}
    else:
        require(columns == 0, "Image collection columns must be zero")
    seen = []
    for tile in node.findall("tile"):
        local = xml_integer(tile, "id")
        seen.append(local)
        if direct is None:
            source, source_path = opened_image(tile.find("image"))
            if any(k in tile.attrib for k in ("x", "y", "width", "height")):
                x, y = xml_integer(tile, "x"), xml_integer(tile, "y")
                tw, th = xml_integer(tile, "width", minimum=1), xml_integer(tile, "height", minimum=1)
                require(x+tw <= source.width and y+th <= source.height, "Incomplete/out-of-bounds frame subrectangle")
                images[local] = source.crop((x, y, x+tw, y+th))
                rectangles[local] = {"path": source_path, "rect": [x, y, tw, th]}
            else:
                images[local] = source
                rectangles[local] = {"path": source_path, "rect": [0, 0, source.width, source.height]}
            require(images[local].width <= w and images[local].height <= h
                    and images[local].getchannel("A").getbbox() is not None, "Empty/incomplete collection artwork")
        else:
            require(local < count, "Out-of-range atlas tile")
        animation = tile.find("animation")
        if animation is not None:
            frames = animation.findall("frame")
            require(bool(frames), "Empty serialized animation")
            animations[local] = {"ids": [xml_integer(f, "tileid") for f in frames],
                                 "durations": [xml_integer(f, "duration", minimum=1) for f in frames]}
    unique(seen, "serialized tile ids")
    require(direct is not None or len(images) == count, "Collection tilecount mismatch")
    for local, animation in animations.items():
        require(all(i in images and i not in animations and images[i].getchannel("A").getbbox()
                    and images[i].size == images[local].size for i in animation["ids"]), "Invalid/empty/incomplete animation frame reference")
    for prop in node.findall("properties/property"):
        if prop.get("name") in ("source_image", "source_license"):
            resolve_reference(root, path, prop.get("value"))
    return {"tsx": path, "images": images, "animations": animations, "capacity": max(images)+1,
            "rectangles": rectangles, "xml": node}


def parse_map(root, path, size):
    node = ET.fromstring(root.read(path)[0])
    require(node.tag == "map" and node.get("orientation") == "orthogonal" and node.get("infinite") == "0"
            and node.get("renderorder") == "right-down", "Not a finite orthogonal map")
    width, height = xml_integer(node, "width", minimum=1), xml_integer(node, "height", minimum=1)
    require(xml_integer(node, "tilewidth") == xml_integer(node, "tileheight") == size, "Map cell geometry changed")
    ranges, tiles = [], {}
    for ref in node.findall("tileset"):
        target = resolve_reference(root, path, ref.get("source"))
        ts = read_tileset(root, target)
        first = xml_integer(ref, "firstgid", minimum=1)
        ranges.append((first, first+ts["capacity"], target))
        for local, image in ts["images"].items():
            require(first+local not in tiles, "Overlapping GID registration")
            tiles[first+local] = {"image": image, "animation": ts["animations"].get(local),
                                  "images": ts["images"], "tsx": target, "local_id": local,
                                  "source": ts["rectangles"][local]}
    require(ranges == sorted(ranges) and all(a[1] <= b[0] for a, b in zip(ranges, ranges[1:])), "Unsorted/overlapping GID ranges")
    layer_ids = [xml_integer(n, "id", minimum=1) for n in node.iter() if n.tag in ("group", "layer", "objectgroup")]
    object_ids = [xml_integer(n, "id", minimum=1) for n in node.iter("object")]
    unique(layer_ids, "map layer ids")
    unique(object_ids, "map object ids")
    require(xml_integer(node, "nextlayerid", minimum=1) > max(layer_ids, default=0)
            and xml_integer(node, "nextobjectid", minimum=1) > max(object_ids, default=0), "Map next ids invalid")
    primitives = []

    def place(tile, x, y, entity):
        require(tile["image"].getchannel("A").getbbox() is not None, f"Empty required artwork: {entity}")
        frames = [tile["images"][i] for i in tile["animation"]["ids"]] if tile["animation"] else [tile["image"]]
        for frame in frames:
            require(0 <= x and 0 <= y and x+frame.width <= width*size and y+frame.height <= height*size,
                    f"Clipped complete artwork: {entity}")
        primitives.append({**tile, "x": x, "y": y, "entity": entity})

    def walk(parent, shown=True, ox=0, oy=0):
        for child in parent:
            if child.tag not in ("group", "layer", "objectgroup"):
                require(child.tag not in ("imagelayer",), "Unsupported image layer")
                continue
            require(child.get("visible", "1") in ("0", "1") and child.get("opacity", "1") == "1"
                    and child.get("blendmode", "normal") == "normal", "Invalid effective layer opacity/blend/visibility")
            visible = shown and child.get("visible", "1") == "1"
            x = ox + xml_integer(child, "offsetx", "0")
            y = oy + xml_integer(child, "offsety", "0")
            if child.tag == "group":
                walk(child, visible, x, y)
            elif child.tag == "layer":
                require(xml_integer(child, "width") == width and xml_integer(child, "height") == height
                        and xml_integer(child, "x", "0") == xml_integer(child, "y", "0") == 0, "Layer geometry changed")
                data = child.find("data")
                require(data is not None and data.get("encoding") == "csv" and data.get("compression") is None
                        and not list(data), "Expected finite uncompressed CSV")
                cells = [int(v.strip()) for v in (data.text or "").strip().split(",")]
                require(len(cells) == width*height, "Truncated/oversized map cells")
                entity = property_values(child).get("entity", f"layer:{child.get('id')}")
                require(any(cells), f"Empty required material layer: {entity}")
                for index, gid in enumerate(cells):
                    require(0 <= gid < 0x10000000, "Transformed/invalid layer GID")
                    if gid:
                        require(gid in tiles and visible, f"Hidden/unregistered required layer artwork: {entity}")
                        tile = tiles[gid]
                        place(tile, x+index%width*size, y+(index//width+1)*size-tile["image"].height, entity)
            else:
                require(child.get("draworder") == "index", "Required explicit object draw order")
                for obj in child.findall("object"):
                    require(obj.get("visible", "1") in ("0", "1") and obj.get("rotation", "0") == "0", "Object visibility/rotation changed")
                    gid = xml_integer(obj, "gid", minimum=1)
                    require(gid < 0x10000000 and gid in tiles and visible and obj.get("visible", "1") == "1",
                            "Hidden/transformed/unregistered required object artwork")
                    tile = tiles[gid]
                    require((xml_integer(obj, "width", minimum=1), xml_integer(obj, "height", minimum=1)) == tile["image"].size,
                            "Scaled/incomplete object artwork")
                    entity = property_values(obj).get("entity", f"object:{obj.get('id')}")
                    place(tile, x+xml_integer(obj, "x"), y+xml_integer(obj, "y")-tile["image"].height, entity)
    walk(node)
    require(bool(primitives), "Empty editable map")
    return {"path": path, "size": [width*size, height*size], "primitives": primitives, "xml": node, "ranges": ranges}


def primitive_image(primitive, elapsed):
    if not primitive["animation"]:
        return primitive["image"]
    animation = primitive["animation"]
    return primitive["images"][animation["ids"][frame_index_at(animation["durations"], elapsed)]]


def render_graph(graph, elapsed=0):
    width, height = graph["size"]
    canvas = np.zeros((height, width, 4), dtype=np.uint8)
    for primitive in graph["primitives"]:
        source = premultiply(primitive_image(primitive, elapsed))
        x, y = primitive["x"], primitive["y"]
        destination = canvas[y:y+source.shape[0], x:x+source.shape[1]]
        destination[:] = source_over(destination, source)
    return canvas


def visible_entities(graph, elapsed=0):
    width, height = graph["size"]
    transmittance = np.full((height, width), 255, dtype=np.uint8)
    counts = {p["entity"]: 0 for p in graph["primitives"]}
    for primitive in reversed(graph["primitives"]):
        alpha = np.asarray(primitive_image(primitive, elapsed))[:, :, 3]
        x, y = primitive["x"], primitive["y"]
        region = transmittance[y:y+alpha.shape[0], x:x+alpha.shape[1]]
        counts[primitive["entity"]] += int(np.count_nonzero(byte_multiply(alpha, region)))
        region[:] = byte_multiply(region, 255-alpha)
    require(all(count > 0 for count in counts.values()),
            f"Fully occluded/invisible required art: {[e for e, count in counts.items() if not count]}")
    return counts


def gallery_pages(root, directory, name, image):
    """Bounded nearest-neighbor diagnostic pages, with checker and ground contexts."""
    pages = []
    zoom, stride = 2, 960
    for y in range(0, image.height, stride):
        for x in range(0, image.width, stride):
            crop = image.crop((x, y, min(x+stride, image.width), min(y+stride, image.height)))
            for context in ("checker", "ground"):
                painted = context_image(crop, context == "ground").resize((crop.width*zoom, crop.height*zoom), Image.Resampling.NEAREST)
                page = Image.new("RGBA", (painted.width, painted.height+40), (23, 30, 37, 255))
                page.paste(painted, (0, 40))
                ImageDraw.Draw(page).text((6, 8), f"{name} / computational preview, NOT native/visual approval / {context}", fill="white")
                require(max(page.size) <= 2000, "Gallery page bounds exceeded")
                path = f"{directory}/pages/{name}-{len(pages)+1:03d}-{context}.png"
                content = png_bytes(page)
                root.write(path, content)
                pages.append({"path": path, "sha256": sha256(content), "dimensions": list(page.size),
                              "source_rect": [x, y, crop.width, crop.height], "zoom": zoom, "context": context})
    return pages


def map_evidence(root, directory, entry, size):
    graph = parse_map(root, entry["path"], size)
    require(set(entry["entities"]) == {p["entity"] for p in graph["primitives"]}, "Declared coverage differs from editable XML artwork")
    times = {0}
    for primitive in graph["primitives"]:
        if primitive["animation"]:
            times.update(animation_probes(primitive["animation"]["durations"]))
    counts = {}
    for elapsed in sorted(times):
        counts[str(elapsed)] = visible_entities(graph, elapsed)
    image = unpremultiply(render_graph(graph))
    name = PurePosixPath(entry["path"]).stem
    # Prefix kind prevents consumer scene/gallery identifier collisions in evidence paths.
    name = f"{entry['kind']}-{name}"
    image_path = f"{directory}/previews/{name}.png"
    root.write(image_path, png_bytes(image))
    pages = gallery_pages(root, directory, name, image)
    probes = []
    if len(times) > 1:
        for elapsed in sorted(times):
            image = unpremultiply(render_graph(graph, elapsed))
            path = f"{directory}/previews/playback/{name}-{elapsed}ms.png"
            content = png_bytes(image)
            root.write(path, content)
            probes.append({"elapsed_ms": elapsed, "path": path, "sha256": sha256(content),
                           "pages": gallery_pages(root, directory, f"{name}-{elapsed}ms", image)})
    return {**entry, "map_sha256": sha256(root.read(entry["path"])[0]), "preview": image_path,
            "preview_sha256": sha256(root.read(image_path)[0]), "pages": pages, "animation_probes": probes,
            "visible_entities": counts, "proof": "computational-only; no native or independent visual PASS"}


def build_candidate(inputs, manifest, manifest_path, candidate_id, *, allow_test_trust=False):
    identifier(candidate_id, "candidate id")
    inventory = validate_inventory(inputs, manifest)
    sources = load_sources(inputs, manifest)
    catalogs = load_catalogs(inputs, manifest, sources)
    frozen_doc, frozen = load_frozen(inputs, manifest, catalogs, sources)
    approval = check_source_geometry(inputs, manifest, manifest_path, sources, catalogs, frozen_doc, frozen,
                                     allow_test_trust=allow_test_trust)
    scenes = load_scenes(inputs, manifest, catalogs, sources)
    identity, runtime = tool_identity(), capabilities(manifest)
    directory = f"{manifest['output_root']}/candidates/{candidate_id}"
    inputs.root.mkdir(directory)
    inputs.root.write(f"{directory}/owner.json", json_bytes({"schema_version": 1, "consumer": manifest["id"],
                      "operation": "build", "id": candidate_id, "test_only": approval["test_only"]}))
    original_licenses = {r["path"]: r["license"] for r in manifest["originals"]}
    licenses = {r["id"]: r["path"] for r in manifest["licenses"]}
    registrations = {key: register_source(inputs.root, directory, source, licenses[original_licenses[source["path"]]])
                     for key, source in sources.items()}
    terrains = {(pack, f["id"]): register_terrain(inputs.root, directory, pack, f, sources[f["source"]], manifest["cell_size"])
                for pack, cat in catalogs.items() for f in cat["families"]}
    parts = {pack: register_parts(inputs.root, directory, pack, cat, sources) for pack, cat in catalogs.items()}
    entries = []
    for pack in catalogs:
        items = []
        for source_id, asset in registrations.items():
            if asset["source"]["pack"] != pack:
                continue
            for slot, local in asset["static"].items():
                items.append({"asset": asset, "tile": local, "entity": f"{source_id}:frame:{slot}"})
            for alias, local in asset["aliases"].items():
                items.append({"asset": asset, "tile": local, "entity": f"{source_id}:alias:{alias}"})
        entries.append(gallery_map(inputs.root, f"{directory}/maps/inventory/{pack}.tmx", "source-inventory", items, manifest["cell_size"]))
        playback = [{"asset": a, "tile": local, "entity": f"{source_id}:animation:{animation}"}
                    for source_id, a in registrations.items() if a["source"]["pack"] == pack
                    for animation, local in a["animated"].items()]
        if playback:
            entries.append(gallery_map(inputs.root, f"{directory}/maps/playback/{pack}.tmx", "playback", playback, manifest["cell_size"]))
        items = [{"asset": a, "tile": local, "entity": f"{p}:{family}:mask:{mask}"}
                 for (p, family), a in terrains.items() if p == pack
                 for mask, local in a["mask_ids"].items() if local is not None]
        entries.append(gallery_map(inputs.root, f"{directory}/maps/terrain/{pack}.tmx", "terrain-masks", items, manifest["cell_size"]))
        if parts[pack]:
            a = parts[pack]
            items = [{"asset": a, "tile": local, "entity": f"{pack}:component:{part}"} for part, local in a["ids"].items()]
            entries.append(gallery_map(inputs.root, f"{directory}/maps/parts/{pack}.tmx", "complete-parts", items, manifest["cell_size"]))
    entries.extend(pattern_map(inputs.root, directory, p, terrains, manifest["cell_size"]) for p in scenes["patterns"])
    entries.extend(scene_map(inputs.root, directory, s, terrains, registrations, parts, catalogs, manifest["cell_size"]) for s in scenes["scenes"])
    evidence = [map_evidence(inputs.root, directory, entry, manifest["cell_size"]) for entry in entries]
    source_metadata = []
    for key, asset in registrations.items():
        source = sources[key]
        source_metadata.append({"id": key, "pack": source["pack"], "path": source["path"], "sha256": source["sha256"],
            "dimensions": list(source["image"].size), "frame_size": source["frame_size"], "kind": source["kind"],
            "tsx": asset["tsx"], "slots": [{**s, "alpha_bbox": source["alpha_bboxes"][s["id"]],
                                             "usable_tile_id": asset["static"].get(s["id"])} for s in source["slots"]],
            "aliases": [{**a, "tile_id": asset["aliases"][a["id"]]} for a in source["aliases"]],
            "animations": [{**a, "tile_id": asset["animated"][a["id"]]} for a in source["animations"]],
            "license": original_licenses[source["path"]], "gid_capacity": asset["capacity"]})
    provenance = {"schema_version": 1, "consumer": manifest["id"], "profile": manifest["profile"], "cell_size": manifest["cell_size"],
                  "source_approval": approval, "tool": identity, "capabilities": runtime,
                  "sources": source_metadata, "terrains": [
                      {"pack": p, "family": f, "tsx": a["tsx"], "atlas": a["atlas"], "mode": a["family"]["mode"],
                       "mask_ids": {str(m): local for m, local in a["mask_ids"].items()}, "quarters": {str(m): t for m, t in a["traces"].items()},
                       "source": a["family"]["source"], "roles": a["family"]["roles"]} for (p, f), a in terrains.items()],
                  "components": [{"pack": pack, **part, "tsx": parts[pack]["tsx"], "tile_id": parts[pack]["ids"][part["id"]]}
                                 for pack, cat in catalogs.items() for part in cat["components"]], "maps": evidence}
    inputs.root.write(f"{directory}/provenance.json", json_bytes(provenance))
    inputs.root.write(f"{directory}/{manifest['id']}.tiled-project", json_bytes({"folders": ["maps", "tilesets"], "propertyTypes": []}))
    inputs.recheck()
    # Reread current bytes rather than the initial cache, and close the original scope again.
    from .manifest import Inputs
    require(current_inventory(Inputs(inputs.root), manifest) == inventory, "Closed originals changed during build")
    require(tool_identity() == identity and capabilities(manifest) == runtime, "Tool/dependency/capability changed during build")
    files = inputs.root.files(directory)
    output_files = []
    for path in files:
        content = inputs.root.read(path)[0]
        output_files.append({"path": path, "size_bytes": len(content), "sha256": sha256(content)})
    output_inventory = {"schema_version": 1, "consumer": manifest["id"], "candidate": candidate_id, "files": output_files}
    inventory_path = f"{directory}/output-inventory.json"
    inputs.root.write(inventory_path, json_bytes(output_inventory))
    report = {"schema_version": 1, "operation": "build", "status": "CANDIDATE_TEST_ONLY" if approval["test_only"] else "CANDIDATE",
              "consumer": manifest["id"], "id": candidate_id, "candidate_path": directory, "selected": False,
              "source_approval": approval, "tool_sha256": identity["sha256"], "input_hashes": inputs.hashes(),
              "output_inventory": {"path": inventory_path, "sha256": sha256(json_bytes(output_inventory))},
              "provenance": {"path": f"{directory}/provenance.json", "sha256": sha256(json_bytes(provenance))},
              "owned_paths": inputs.root.owned_paths(directory),
              "counts": {"originals": len(inventory["files"]), "sources": len(sources), "families": len(terrains),
                         "terrain_candidates": sum(a["capacity"] for a in terrains.values()),
                         "static_frames": sum(len(a["static"]) for a in registrations.values() if a["source"]["kind"] == "sprite"),
                         "animations": sum(len(a["animated"]) for a in registrations.values()),
                         "components": sum(len(cat["components"]) for cat in catalogs.values()),
                         "tilesets": len(registrations)+len(terrains)+sum(a is not None for a in parts.values()),
                         "maps": len(evidence), "output_files": len(output_files)},
              "native_proof": False, "native_visual_approval": False,
              "limitations": ["Unselected stable candidate only; native proof, native visual review, and publication are separate gates."]}
    inputs.root.write(f"{directory}/report.json", json_bytes(report))
    # Inventory excludes itself and report to avoid self-referential hashes; neither is artwork.
    inputs.recheck()
    for row in output_files:
        require(sha256(inputs.root.read(row["path"])[0]) == row["sha256"], "Candidate output changed during build")
    return report
