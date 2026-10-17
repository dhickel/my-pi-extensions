"""Independent gesture intent. Widths count vertices, never pixels or tile cells.

Every saved stage is declared before native execution. Inverse strokes restore
captured prior values; these recipes make no GUI/modifier/editor-undo claim.
"""
from __future__ import annotations

from itertools import product

from .manifest import integer, json_bytes, require, sha256, unique

CELLS = 12
VERTICES = 13
DIRECTIONS = {"n": (0, -1), "e": (1, 0), "s": (0, 1), "w": (-1, 0)}


def masks(field):
    require(len(field) == VERTICES and all(len(row) == VERTICES for row in field), "Draw field must be 13x13")
    for row in field:
        for value in row:
            require(type(value) is int and value in (0, 1), "Binary integer gesture field required")
    return [[field[y][x] + 2*field[y][x+1] + 4*field[y+1][x+1] + 8*field[y+1][x]
             for x in range(CELLS)] for y in range(CELLS)]


def interpret(field, requests):
    result = [row[:] for row in field]
    prior, accepted, seen = [], [], set()
    for request in requests:
        require(type(request) is list and len(request) == 3, "Vertex request must be [x,y,value]")
        x, y, value = request
        require(type(x) is type(y) is int and type(value) is int and value in (0, 1), "Invalid vertex request")
        inside = 0 <= x < VERTICES and 0 <= y < VERTICES
        if (x, y) not in seen:
            prior.append([x, y, result[y][x] if inside else None])
            seen.add((x, y))
        if inside:
            accepted.append(request[:])
            result[y][x] = value
    return result, accepted, prior


def _box(points, margin=1):
    points = [(x, y) for x, y in points if 0 <= x <= CELLS and 0 <= y <= CELLS]
    if not points:
        return [4, 4, 4, 4]
    left = max(0, min(x for x, _ in points)-margin)
    top = max(0, min(y for _, y in points)-margin)
    right = min(CELLS, max(x for x, _ in points)+margin)
    bottom = min(CELLS, max(y for _, y in points)+margin)
    return [left, top, max(1, right-left), max(1, bottom-top)]


class _Recipe:
    def __init__(self, group, variant, intent, width=None, orientations=()):
        self.case = {"id": f"{group}-{variant}", "group": group, "variant": variant,
                     "width_vertices": width, "orientations": list(orientations), "intent": intent,
                     "initial_field": [[0]*VERTICES for _ in range(VERTICES)],
                     "clipping": "accept vertices 0..12; prune only outside native cells after apply",
                     "stages": []}
        self.field = [row[:] for row in self.case["initial_field"]]
        self.stroke("seed", [], "Initialize once to explicit opaque B or alpha null over unchanged ground.")

    def stroke(self, name, requests, intent, *, equivalent=None):
        raw = [list(r) for r in requests]
        after, accepted, prior = interpret(self.field, raw)
        active = [(x, y) for y, row in enumerate(after) for x, value in enumerate(row) if value]
        changed = [(r[0], r[1]) for r in accepted]
        crops = [{"id": "contour-and-gaps", "cell_rect": _box(active+changed)},
                 {"id": "stroke-local", "cell_rect": _box(changed)}]
        if self.case["group"] == "04":
            crops += [{"id": "junction-center", "cell_rect": [4, 4, 5, 5]}]
            for direction in self.case["orientations"]:
                dx, dy = DIRECTIONS[direction]
                width = self.case["width_vertices"]
                tips = [_rect(6+dx*d, 6+dy*d, 5+width+dx*d, 5+width+dy*d)
                        for d in range(1, 5-width)]
                relevant = set(active+changed)
                # Adjacent width-two blocks overlap. Only the outward end face
                # establishes that distance; overlap alone must not advance it.
                def end_face(points):
                    extent = max(x*dx+y*dy for x, y in points)
                    return {(x, y) for x, y in points if x*dx+y*dy == extent}
                tip = next((points for points in reversed(tips) if relevant.intersection(end_face(points))), tips[-1])
                crops.append({"id": f"arm-tip-{direction}", "cell_rect": _box(tip)})
        if self.case["group"] == "08":
            crops.append({"id": "finite-boundary", "cell_rect": _box(changed, 2)})
        stage = {"id": f"s{len(self.case['stages']):03d}-{name}", "raw_requests": raw,
                 "accepted_requests": accepted, "captured_prior": prior,
                 "expected_field": after, "field_sha256": sha256(json_bytes(after)),
                 "intent": intent, "equivalence": equivalent, "crops": crops,
                 "pages": ["ground-intent-expected-native", "checker-intent-expected-native"]}
        self.case["stages"].append(stage)
        self.field = after
        return stage

    def paint(self, name, points, value=1, intent=None, **kwargs):
        return self.stroke(name, [[x, y, value] for x, y in points], intent or
                           f"{name}: {'A paint' if value else 'B repaint/erase'} at the explicit listed vertices.", **kwargs)

    def inverse(self, name, stage, intent=None):
        return self.stroke(name, [[x, y, value] for x, y, value in reversed(stage["captured_prior"]) if value is not None],
                           intent or "Inverse stroke restores each captured prior material, including overlapping A vertices.")

    def clear(self):
        return self.paint("clear", product(range(VERTICES), repeat=2), 0,
                          "Clear all vertices to opaque color 2 artwork or alpha color 0 null, retaining ground.")


def _line(axis, start, end, fixed, width=1):
    step = 1 if end >= start else -1
    return [(v, fixed+d) if axis == "h" else (fixed+d, v)
            for v in range(start, end+step, step) for d in range(width)]


def _rect(x0, y0, x1, y1):
    return [(x, y) for y in range(y0, y1+1) for x in range(x0, x1+1)]


def _fill_rows(recipe, prefix, rect, value=1):
    x0, y0, x1, y1 = rect
    return [recipe.paint(f"{prefix}-row-{y}", _rect(x0, y, x1, y), value) for y in range(y0, y1+1)]


def _prior_union(stages):
    rows = {}
    for stage in stages:
        for x, y, value in stage["captured_prior"]:
            rows.setdefault((x, y), value)
    return {"captured_prior": [[x, y, value] for (x, y), value in rows.items()]}


def declare_cases():
    """All eleven groups, all orientations and both vertex-width expansions."""
    cases = []
    for direction, (dx, dy) in DIRECTIONS.items():
        r = _Recipe("01", direction, "Interior island, repeated click, directional neighbor growth, inverse, clear and resume.", orientations=[direction])
        point = r.paint("point", [(6, 6)])
        r.paint("repeat-point", [(6, 6)])
        neighbor = r.paint("grow-neighbor", [(6+dx, 6+dy)])
        r.inverse("inverse-neighbor", neighbor)
        r.inverse("clear-point", point)
        r.paint("resume", [(6, 6)])
        cases.append(r.case)
    for axis, sign in product(("h", "v"), (-1, 1)):
        r = _Recipe("02", f"{axis}-{'reverse' if sign < 0 else 'forward'}", "Incremental row rectangle growth; separately shrink every N/E/S/W perimeter.", orientations=[axis])
        first_row = 3 if sign > 0 else 8
        r.paint("start-short-row", _line(axis, 3 if sign > 0 else 8, 5 if sign > 0 else 6, first_row))
        r.paint("extend-short-row", _line(axis, 6 if sign > 0 else 5, 8 if sign > 0 else 3, first_row))
        for row in (range(4, 9) if sign > 0 else range(7, 2, -1)):
            r.paint(f"grow-row-{row}", _line(axis, 3 if sign > 0 else 8, 8 if sign > 0 else 3, row))
        for side, points in (("n", _rect(3, 3, 8, 3)), ("e", _rect(8, 4, 8, 8)),
                             ("s", _rect(3, 8, 7, 8)), ("w", _rect(3, 4, 3, 7))):
            r.paint(f"shrink-{side}", points, 0)
        r.clear()
        r.paint("resume-short-row", _line(axis, 5, 7, 6))
        cases.append(r.case)
    for axis, width in product(("h", "v"), (1, 2)):
        r = _Recipe("03", f"{axis}-w{width}", "Corridor extends one segment at a time; direct width two and width one widening compare only equal fields.", width, [axis])
        segments = [r.paint(f"extend-{v}", _line(axis, v, v, 5, width)) for v in range(3, 10)]
        r.stroke("equivalent-direct", [], "Complete direct corridor field.", equivalent=f"corridor-{axis}-w{width}")
        r.inverse("shorten", segments[-1])
        r.paint("restore-tip", _line(axis, 9, 9, 5, width))
        if width == 1:
            widened = r.paint("widen-to-two", _line(axis, 3, 9, 6), equivalent=f"corridor-{axis}-w2")
            r.inverse("narrow-to-one", widened)
        else:
            narrowed = r.paint("narrow-to-one", _line(axis, 3, 9, 6), 0, equivalent=f"corridor-{axis}-w1")
            r.inverse("rewiden", narrowed)
        r.clear()
        cases.append(r.case)
    forms = [(f"l-{a}{b}", [a, b]) for a, b in (("n", "e"), ("e", "s"), ("s", "w"), ("w", "n"))]
    forms += [(f"t-without-{missing}", [d for d in DIRECTIONS if d != missing]) for missing in DIRECTIONS]
    forms += [("cross", list(DIRECTIONS))]
    for (name, arms), width in product(forms, (1, 2)):
        r = _Recipe("04", f"{name}-w{width}", "Add junction arms separately; inspect center, inside corners, and every arm tip. Withdraw/restore captured overlap.", width, arms)
        r.paint("junction-center", _rect(6, 6, 5+width, 5+width))
        added = []
        for direction in arms:
            dx, dy = DIRECTIONS[direction]
            arm = []
            for distance in range(1, 5-width):
                points = _rect(6+dx*distance, 6+dy*distance, 5+width+dx*distance, 5+width+dy*distance)
                arm.append(r.paint(f"add-{direction}-{distance}", points))
            added.append((direction, _prior_union(arm)))
        r.stroke("complete-junction", [], "All declared arms connected, tips distinct and concave junction corners visible.")
        withdrawn = [r.inverse(f"withdraw-{direction}", prior) for direction, prior in reversed(added)]
        for index, prior in enumerate(reversed(withdrawn)):
            r.inverse(f"restore-arm-{index}", prior)
        r.clear()
        cases.append(r.case)
    for direction, (dx, dy) in DIRECTIONS.items():
        r = _Recipe("05", direction, "Filled rectangle develops a 2x2 hole, opens a directional notch, closes and refills it.", orientations=[direction])
        _fill_rows(r, "fill", (3, 3, 9, 9))
        hole = [r.paint("erase-hole-vertex", [(6, 6)], 0)]
        hole += [r.paint(f"grow-hole-{x}-{y}", [(x, y)], 0) for x, y in ((5, 6), (5, 5), (6, 5))]
        notch = []
        for distance in range(1, 4):
            points = [(6+dx*distance, 6+dy*distance), (5+dx*distance, 5+dy*distance)]
            notch.append(r.paint(f"open-notch-{distance}", points, 0))
        r.inverse("close-notch", _prior_union(notch))
        r.inverse("refill-hole", _prior_union(hole))
        r.clear()
        cases.append(r.case)
    for mirror in (False, True):
        r = _Recipe("06", "mirrored" if mirror else "original", "Outer ring, isolated inner island and persistent one-vertex gaps; mirrored island placement.")
        _fill_rows(r, "outer-fill", (3, 3, 9, 9))
        _fill_rows(r, "hollow", (4, 4, 8, 8), 0)
        x = 7 if mirror else 5
        r.paint("inner-island", [(x, 6)])
        grow = r.paint("grow-island", [(6, 6)])
        vertical = r.paint("grow-island-vertical", [(x, 7)])
        r.inverse("shrink-island-vertical", vertical)
        r.inverse("shrink-island", grow)
        cut = r.paint("cut-outer-boundary", [(x, 3)], 0)
        r.inverse("refill-outer-boundary", cut)
        r.clear()
        cases.append(r.case)
    saddles = [("mask5", [(6, 6), (7, 7)]), ("mask10", [(7, 6), (6, 7)]),
               ("chain-down", [(v, v) for v in range(3, 10)]),
               ("chain-up", [(v, 12-v) for v in range(3, 10)])]
    saddles += [(f"checker-parity-{p}", [(x, y) for y in range(4, 9) for x in range(4, 9) if (x+y)%2 == p]) for p in (0, 1)]
    for name, points in saddles:
        r = _Recipe("07", name, "Diagonal saddles/chains/checker parity formed exclusively by individual clicks, never diagonal drags.")
        clicked = [r.paint(f"click-{i}", [point]) for i, point in enumerate(points)]
        withdrawn = [r.inverse(f"withdraw-click-{i}", stage) for i, stage in enumerate(reversed(clicked[::2]))]
        for i, stage in enumerate(reversed(withdrawn)):
            r.inverse(f"restore-click-{i}", stage)
        r.clear()
        cases.append(r.case)
    bounds = [("n", (6, 0)), ("e", (12, 6)), ("s", (6, 12)), ("w", (0, 6)),
              ("nw", (0, 0)), ("ne", (12, 0)), ("se", (12, 12)), ("sw", (0, 12))]
    for (name, (x, y)), axis in product(bounds, ("h", "v")):
        r = _Recipe("08", f"{name}-{axis}", "Explicit finite adapter accepts only vertices 0..12. Boundary, cross, entry and wholly outside requests cannot wrap.", orientations=[name, axis])
        r.paint("boundary-point", [(x, y)])
        points = [(x+v, y) if axis == "h" else (x, y+v) for v in range(-2, 3)]
        boundary = r.paint("boundary-segment", points)
        crossing = []
        # A tangent straight line cannot cross its parallel side. Tangent
        # variants approach OUTSIDE along H/V, then turn normally across the
        # named side as explicit Manhattan clicks. Corners cross the named
        # H-side or V-side. All sixteen distinct variants retain seven stages.
        if name in ("n", "s") and axis == "h":
            outside, step = (-2, 1) if name == "n" else (14, -1)
            crossing_points = [(x-2, outside), (x-1, outside), (x, outside)]
            crossing_points += [(x, outside+step*d) for d in range(1, 5)]
        elif name in ("e", "w") and axis == "v":
            outside, step = (-2, 1) if name == "w" else (14, -1)
            crossing_points = [(outside, y-2), (outside, y-1), (outside, y)]
            crossing_points += [(outside+step*d, y) for d in range(1, 5)]
        elif axis == "h":
            edge = 0 if x == 0 else 12
            crossing_points = [(v, y) for v in (range(-2, 5) if edge == 0 else range(14, 7, -1))]
        else:
            edge = 0 if y == 0 else 12
            crossing_points = [(x, v) for v in (range(-2, 5) if edge == 0 else range(14, 7, -1))]
        for i, point in enumerate(crossing_points):
            crossing.append(r.paint(f"enter-cross-{i}", [point]))
        r.paint("wholly-outside", [(-3, -2), (-2, -2), (14, 14), (15, 14)])
        inverse = r.inverse("inverse-crossing", _prior_union(crossing))
        r.inverse("restore-crossing", inverse)
        r.inverse("inverse-boundary", boundary)
        r.clear()
        r.paint("restore-boundary-point", [(x, y)])
        cases.append(r.case)
    for axis, width in product(("h", "v"), (1, 2)):
        r = _Recipe("09", f"{axis}-w{width}", "Two separate banks join by bridge, cut apart, restore, withdraw and rejoin.", width, [axis])
        transpose = lambda points: points if axis == "h" else [(y, x) for x, y in points]
        for side, a, b in (("near", 3, 4), ("far", 8, 9)):
            for y in range(4, 9):
                r.paint(f"bank-{side}-row-{y}", transpose(_rect(a, y, b, y)))
        bridge = [r.paint(f"join-{x}", transpose(_rect(x, 6, x, 5+width))) for x in range(5, 8)]
        cut = r.paint("cut-bridge", transpose(_rect(6, 6, 6, 5+width)), 0)
        r.inverse("restore-cut", cut)
        withdraw = r.inverse("withdraw-bridge", _prior_union(bridge))
        r.inverse("rejoin-bridge", withdraw)
        r.clear()
        cases.append(r.case)
    shapes = {"point": [[(6, 6)]], "edge": [[(x, 6)] for x in range(3, 10)],
              "junction": [[(x, 6)] for x in range(3, 10)]+[[(6, y)] for y in range(3, 10)],
              "filled": [_rect(3, y, 9, y) for y in range(3, 10)]}
    for name, segments in shapes.items():
        r = _Recipe("10", name, "B is actual nonnull color2 artwork in opaque mode; color0 null in alpha mode with byte-identical ground.")
        stages = [r.paint(f"paint-{i}", points) for i, points in enumerate(segments)]
        for i, points in enumerate(segments):
            r.paint(f"repaint-erase-{i}", points, 0)
        r.inverse("clear-repainted-shape", _prior_union([r.paint("paint-shaped-again", [p for s in segments for p in s])]))
        # Complete dense clear is independently required after shaped erase.
        for y in range(VERTICES):
            r.paint(f"dense-row-{y}", [(x, y) for x in range(VERTICES)])
        r.clear()
        r.paint("resume", [(6, 6)])
        require(bool(stages), "Repaint shape missing")
        cases.append(r.case)
    paths = []
    for axis, width in product(("h", "v"), (1, 2)):
        points = _line(axis, 3, 9, 5, width)
        paths.append((f"straight-{axis}-w{width}", points, width, [axis]))
    for order, width in product(("hv", "vh"), (1, 2)):
        h = _line("h", 3, 8, 3 if order == "hv" else 8, width)
        v = _line("v", 3, 8, 8 if order == "hv" else 3, width)
        # The two path orders must have the SAME field: use the same L union,
        # traversed in opposite order, not different L orientations.
        h, v = _line("h", 3, 8, 3, width), _line("v", 3, 8, 8, width)
        paths.append((f"manhattan-{order}-w{width}", h+v if order == "hv" else list(reversed(v))+list(reversed(h)), width, [order]))
    for name, points, width, orientations in paths:
        equivalence = name.replace("-hv-", "-ordered-").replace("-vh-", "-ordered-")
        for style in ("clicks", "segments", "shift-line-equivalent"):
            r = _Recipe("11", f"{name}-{style}", "Explicit click, segmented Manhattan and Shift-line-equivalent vertex lists; equivalence only on identical complete fields.", width, orientations)
            chunks = [[p] for p in points] if style == "clicks" else [points[i:i+width*2] for i in range(0, len(points), width*2)] if style == "segments" else [points]
            drawn = [r.paint(f"request-{i}", chunk) for i, chunk in enumerate(chunks)]
            r.stroke("equivalent-field", [], "Equivalent fully constrained unique-candidate field.", equivalent=equivalence)
            r.paint("repeat", points)
            inverse = r.inverse("inverse-captured", _prior_union(drawn))
            r.inverse("restore-captured", inverse)
            r.clear()
            cases.append(r.case)
    for style in ("clicks", "ctrl-full-tile-equivalent"):
        r = _Recipe("11", f"full-tile-{style}", "Ctrl full-tile equivalence is only all four corners of one cell, not GUI modifier handling.")
        points = [(6, 6), (7, 6), (7, 7), (6, 7)]
        drawn = [r.paint(f"corner-{i}", chunk) for i, chunk in enumerate([[p] for p in points] if style == "clicks" else [points])]
        r.stroke("equivalent-field", [], "All four cell corners painted with corrected surrounding terrain.", equivalent="full-tile-four-corners")
        r.paint("repeat", points)
        inverse = r.inverse("inverse-captured", _prior_union(drawn))
        r.inverse("restore-captured", inverse)
        r.clear()
        cases.append(r.case)
    unique([case["id"] for case in cases], "draw cases")
    require({case["group"] for case in cases} == {f"{g:02d}" for g in range(1, 12)}, "Missing required gesture group")
    equivalent_fields = {}
    for case in cases:
        current = case["initial_field"]
        unique([stage["id"] for stage in case["stages"]], "case stages")
        for stage in case["stages"]:
            after, accepted, prior = interpret(current, stage["raw_requests"])
            require((after, accepted, prior) == (stage["expected_field"], stage["accepted_requests"], stage["captured_prior"]), "Recipe intent mismatch")
            masks(after)
            topology(case, stage, after)
            if stage["equivalence"]:
                key = stage["equivalence"]
                require(key not in equivalent_fields or equivalent_fields[key] == after, "Non-equivalent path comparison")
                equivalent_fields[key] = after
            current = after
    return cases


def topology(case, stage, field):
    """Semantic four-neighbor vertex topology, independently of masks/pixels.

    Stage intent declares component counts and persistent moats/cut gaps. This
    predicate also accepts actual fields reconstructed from native Wang values;
    it is not a comparison to the recipe's expected field.
    """
    masks(field)  # Strict finite binary vertex shape, not a topology verdict.
    if case["group"] not in ("06", "09"):
        return None
    def connected(material):
        pending = {(x, y) for y, row in enumerate(field) for x, value in enumerate(row) if value == material}
        components = []
        while pending:
            component, frontier = set(), [pending.pop()]
            while frontier:
                x, y = frontier.pop()
                component.add((x, y))
                neighbors = {(x+dx, y+dy) for dx, dy in DIRECTIONS.values()} & pending
                pending.difference_update(neighbors)
                frontier.extend(neighbors)
            components.append(component)
        return components
    components, background = connected(1), connected(0)
    name = stage["id"].split("-", 1)[1]
    if case["group"] == "06":
        isolated = name.startswith(("inner-island", "grow-island", "shrink-island", "cut-outer", "refill-outer"))
        wanted = 0 if name in ("seed", "clear") else 2 if isolated else 1
        require(len(components) == wanted, "Nested topology: outer ring/inner island connectivity or separation failed")
        hollow = isolated or name.startswith("hollow-row-")
        cut = name == "cut-outer-boundary"
        require(len(background) == (2 if hollow and not cut else 1),
                "Nested topology: hollow opening/closed-hole background connectivity differs")
        if name.startswith("hollow-row-"):
            last_row = int(name.rsplit("-", 1)[1])
            require(all(field[y][x] == 0 for x, y in _rect(4, 4, 8, last_row)),
                    "Nested topology: incremental hollow gap was not opened")
        if isolated or name == "hollow-row-8":
            moat = _rect(4, 4, 8, 4)+_rect(4, 8, 8, 8)+_rect(4, 5, 4, 7)+_rect(8, 5, 8, 7)
            require(all(field[y][x] == 0 for x, y in moat), "Nested topology: persistent one-vertex moat/gap bridged")
        if isolated:
            island_x = 7 if case["variant"] == "mirrored" else 5
            require(field[3][island_x] == (0 if cut else 1),
                    "Nested topology: declared outer boundary cut/refill vertex differs")
            island = next((c for c in components if (island_x, 6) in c), set())
            require(island and all(5 <= x <= 7 and 5 <= y <= 7 for x, y in island),
                    "Nested topology: inner island missing or joined to outer boundary")
        gap = "incremental-hollow" if name.startswith("hollow-row-") and name != "hollow-row-8" else "persistent-moat" if hollow else "not-yet-hollow"
    else:
        require(len(background) == 1, "Bridge topology: unintended enclosed background hole/second bridge")
        joined = name in ("join-7", "restore-cut", "rejoin-bridge")
        wanted = 0 if name in ("seed", "clear") else 1 if name.startswith("bank-near-") or joined else 2
        require(len(components) == wanted, "Bridge topology: banks connectivity/separation failed")
        transpose = lambda p: p if case["orientations"] == ["h"] else (p[1], p[0])
        if wanted and not name.startswith("bank-near-"):
            near, far = transpose((3, 4)), transpose((8, 4))
            require(any(near in c for c in components) and any(far in c for c in components), "Bridge topology: required banks missing")
            require(any(near in c and far in c for c in components) == joined, "Bridge topology: intended bank connection differs")
        if name in ("cut-bridge", "withdraw-bridge"):
            cut = [transpose((6, y)) for y in range(6, 6+case["width_vertices"])]
            require(all(field[y][x] == 0 for x, y in cut), "Bridge topology: cut gap is not open across full vertex width")
        gap = "connected" if joined else "separated" if wanted == 2 else "seed-or-single-bank"
    return {"status": "PASS", "group": case["group"], "components": len(components),
            "background_components": len(background), "gap": gap}


def inventory(consumer, families, size):
    integer(size, "cell size", 1)
    require(size in (16, 32), "Supported draw size is 16 or 32")
    cases = declare_cases()
    items = []
    for family in families:
        for case in cases:
            for stage in case["stages"]:
                prefix = f"{family['pack']}/{family['family']}/{case['id']}/{stage['id']}"
                items.append({"id": prefix, "kind": "draw-stage", "consumer": consumer,
                              "pack": family["pack"], "family": family["family"], "mode": family["mode"],
                              "case": case["id"], "stage": stage["id"], "cell_size": size,
                              "field_sha256": stage["field_sha256"],
                              "recipe_sha256": sha256(json_bytes(case)), "intent": stage["intent"],
                              "crops": stage["crops"], "pages": stage["pages"]})
    unique([item["id"] for item in items], "expected draw coverage")
    return {"schema_version": 1, "consumer": consumer, "cells": [CELLS, CELLS],
            "vertices": [VERTICES, VERTICES], "width_unit": "vertex rows/columns",
            "cases": cases, "items": items}
