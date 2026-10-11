"""Explicit quarter-corner-v1 roles and untransformed opposite-phase sampling."""
from __future__ import annotations

from PIL import Image

from .manifest import (array, closed, identifier, integer, pair, rectangle, require,
                       text, unique)

ROLE_ORDER = ("background", "solid", "convex-NW", "convex-NE", "convex-SE", "convex-SW",
              "edge-N", "edge-E", "edge-S", "edge-W",
              "concave-NW", "concave-NE", "concave-SE", "concave-SW")
CORNERS = ("NW", "NE", "SE", "SW")
SIGNS = ((-1, -1), (1, -1), (1, 1), (-1, 1))


def load_catalog(doc, pack, sources, size):
    closed(doc, ("schema_version", "pack", "families", "components"), "catalog")
    require(type(doc["schema_version"]) is int and doc["schema_version"] == 1
            and doc["pack"] == pack, "Catalog version/pack mismatch")
    for family in array(doc["families"], "families", True):
        closed(family, ("id", "name", "source", "foreground", "background", "mode", "roles"), "family")
        identifier(family["id"], "family id")
        for key in ("name", "foreground", "background"):
            text(family[key], f"family {key}")
        require(family["foreground"] != family["background"], "Ambiguous material identities")
        require(family["mode"] in ("opaque", "alpha"), "Unknown terrain mode")
        identifier(family["source"], "family source id")
        require(family["source"] in sources and sources[family["source"]]["pack"] == pack
                and sources[family["source"]]["kind"] == "atlas", "Family needs a same-pack source atlas")
        closed(family["roles"], ROLE_ORDER, "full source roles")
        for role, coordinate in family["roles"].items():
            pair(coordinate, role)
        image = sources[family["source"]]["image"]
        require(image.width % size == image.height % size == 0, "Terrain source is not a complete cell grid")
        for role in ROLE_ORDER:
            tile = source_tile(image, family["roles"][role], size)
            low, high = tile.getchannel("A").getextrema()
            if family["mode"] == "opaque":
                require(low == high == 255, f"{family['id']}/{role}: opaque role contains alpha")
            elif role == "background":
                require(high == 0, f"{family['id']}: alpha background must be authored empty")
            else:
                require(high > 0, f"{family['id']}/{role}: empty foreground source role")
    unique([f["id"] for f in doc["families"]], "family ids")
    unique([f["name"] for f in doc["families"]], "family names")
    for part in array(doc["components"], "components"):
        closed(part, ("id", "name", "source", "rect", "kind"), "component")
        identifier(part["id"], "component id")
        text(part["name"], "component name")
        require(part["kind"] in ("stamp", "tall-cliff"), "Unknown complete component kind")
        identifier(part["source"], "component source id")
        require(part["source"] in sources and sources[part["source"]]["pack"] == pack,
                "Component source is not registered to its pack")
        rectangle(part["rect"], "component rect")
        validate_complete_rectangle(sources[part["source"]]["image"], part["rect"], part["id"])
        if part["kind"] == "tall-cliff":
            require(part["rect"][3] > size, "Tall cliff must preserve multirow geometry")
    unique([p["id"] for p in doc["components"]], "component ids")
    return doc


def source_tile(source, coordinate, size):
    pair(coordinate, "full-cell coordinate")
    integer(size, "cell size", 1)
    require(size in (16, 32), "Unsupported quarter geometry")
    x, y = (value * size for value in coordinate)
    require(x + size <= source.width and y + size <= source.height, "Full source role out of bounds")
    return source.crop((x, y, x + size, y + size))


def validate_complete_rectangle(image, rect, label):
    """Validate declared whole-stamp geometry, not inferred alpha-object boundaries."""
    x, y, w, h = rectangle(rect, label)
    require(x + w <= image.width and y + h <= image.height, f"{label}: complete rectangle out of bounds")
    require(image.crop((x, y, x+w, y+h)).getchannel("A").getbbox() is not None,
            f"{label}: empty complete artwork")


def corner_id(mask, mode):
    integer(mask, "mask")
    require(mask < 16 and mode in ("opaque", "alpha"), "Unsupported Wang mask/mode")
    background = 2 if mode == "opaque" else 0
    return [0, 1 if mask & 2 else background, 0, 1 if mask & 4 else background,
            0, 1 if mask & 8 else background, 0, 1 if mask & 1 else background]


def field_masks(vertices):
    array(vertices, "finite vertex field", True)
    require(len(vertices) >= 2, "Vertex field requires at least two rows")
    width = len(array(vertices[0], "vertex row", True))
    require(width >= 2, "Vertex field requires at least two columns")
    for row in vertices:
        array(row, "vertex row")
        require(len(row) == width, "Ragged vertex field")
        for value in row:
            integer(value, "material vertex")
            require(value in (0, 1), "Vertex material must be 0/1")
    return [[vertices[y][x] + 2*vertices[y][x+1] + 4*vertices[y+1][x+1] + 8*vertices[y+1][x]
             for x in range(width-1)] for y in range(len(vertices)-1)]


def matching_masks(constraints, mode):
    require(mode in ("opaque", "alpha") and len(constraints) == 4, "Invalid partial corner constraint")
    background = 2 if mode == "opaque" else 0
    for value in constraints:
        require(value is None or type(value) is int and value in (1, background), "Invalid corner color")
    return [mask for mask in range(16)
            if all(value is None or value == (1 if mask & (1 << bit) else background)
                   for bit, value in enumerate(constraints))]


def normalize(source, family, size):
    """Return supported candidates plus explicit original/destination pixel rectangles."""
    require(size in (16, 32) and source.mode == "RGBA", "Unsupported source/cell geometry")
    half = size // 2
    destinations = ((0, 0), (half, 0), (half, half), (0, half))
    roles = family["roles"]
    candidates, traces = {}, {}
    for mask in range(16):
        if mask == 0 and family["mode"] == "alpha":
            require(source_tile(source, roles["background"], size).getchannel("A").getbbox() is None,
                    "Alpha mask 0 is null; source background must be authored empty")
            continue
        tile = Image.new("RGBA", (size, size))
        trace = []
        if mask in (0, 15):
            role = "solid" if mask else "background"
            x, y = (v * size for v in roles[role])
            tile = source_tile(source, roles[role], size)
            trace.append({"role": role, "source_cell": roles[role], "source_rect": [x, y, size, size],
                          "destination_rect": [0, 0, size, size]})
        else:
            for k, (dx, dy) in enumerate(destinations):
                q = (k + 2) % 4
                horizontal, vertical, diagonal = k ^ 1, 3 - k, q
                sx, sy = SIGNS[q]
                inward = False
                if not mask & (1 << k):
                    role = "background"
                else:
                    side_x, side_y = bool(mask & (1 << horizontal)), bool(mask & (1 << vertical))
                    inward = True
                    if side_x and side_y:
                        if mask & (1 << diagonal):
                            role, inward = "solid", False
                        else:
                            role = f"concave-{CORNERS[q]}"
                    elif not side_x and not side_y:
                        role = f"convex-{CORNERS[q]}"
                    elif not side_x:
                        role = "edge-W" if sx < 0 else "edge-E"
                    else:
                        role = "edge-N" if sy < 0 else "edge-S"
                qx, qy = (0 if sx < 0 else half), (0 if sy < 0 else half)
                if inward:
                    qx, qy = half - qx, half - qy
                x, y = roles[role][0] * size + qx, roles[role][1] * size + qy
                require(x + half <= source.width and y + half <= source.height, "Quarter sample out of bounds")
                tile.paste(source.crop((x, y, x+half, y+half)), (dx, dy))
                trace.append({"role": role, "source_cell": roles[role], "source_rect": [x, y, half, half],
                              "destination_rect": [dx, dy, half, half]})
        low, high = tile.getchannel("A").getextrema()
        require(high > 0, f"{family['id']}/{mask}: empty terrain artwork candidate")
        if family["mode"] == "opaque":
            require(low == 255, "Opaque candidate contains source alpha")
        else:
            for bit, point in enumerate(((0, 0), (size-1, 0), (size-1, size-1), (0, size-1))):
                if not mask & (1 << bit):
                    require(tile.getpixel(point)[3] == 0, "Alpha background corner changed")
        candidates[mask], traces[mask] = tile, trace
    require(len(candidates) == (16 if family["mode"] == "opaque" else 15), "Candidate coverage mismatch")
    return candidates, traces
