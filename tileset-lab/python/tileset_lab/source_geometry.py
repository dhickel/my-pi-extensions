"""Independent full-original-art source approval gate, before normalization.

Records bind evidence and declared reviewer identity. JSON cannot establish that
someone actually viewed an image; the independent reviewer owns that action.
TEST-ONLY records require an explicit test invocation and never certify artwork.
"""
from __future__ import annotations

from pathlib import PurePosixPath

from .manifest import (array, boolean, closed, digest, integer, pair, relative_path,
                       require, sha256, text, unique)
from .pixels import compare_visible, visible_digest
from .sources import capabilities, image_bytes, tool_identity
from .terrain import ROLE_ORDER, source_tile


def check_source_geometry(inputs, manifest, manifest_path, sources, catalogs, frozen_doc, frozen,
                          *, allow_test_trust=False):
    review_path = manifest["source_review"]
    review = closed(inputs.json(review_path), ("schema_version", "consumer", "reviewer", "packet",
                    "tool_sha256", "verdict", "entries"), "independent source review")
    require(type(review["schema_version"]) is int and review["schema_version"] == 1
            and review["consumer"] == manifest["id"], "Source review consumer/version mismatch")
    reviewer = closed(review["reviewer"], ("id", "kind", "independent_of", "image_capable"), "reviewer")
    text(reviewer["id"], "reviewer identity")
    require(reviewer["id"] != frozen_doc["author_id"]
            and reviewer["independent_of"] == frozen_doc["author_id"], "Author cannot approve its own source selection")
    boolean(reviewer["image_capable"], "reviewer image capability")
    require(reviewer["image_capable"], "Independent image access/capability unavailable")
    require(reviewer["kind"] in ("independent", "TEST-ONLY"), "Unknown reviewer trust kind")
    test_only = reviewer["kind"] == "TEST-ONLY"
    if test_only:
        require(allow_test_trust and reviewer["id"].startswith("TEST-ONLY:"),
                "TEST-ONLY trust requires explicit --test-trust; not actual source approval")
    else:
        require(not reviewer["id"].startswith("TEST-ONLY:"), "Synthetic trust cannot claim independent review")
    require(review["verdict"] == "PASS", "Negative/missing source visual review")
    record = closed(review["packet"], ("path", "sha256"), "reviewed source packet")
    relative_path(record["path"])
    digest(record["sha256"])
    require(PurePosixPath(f"{manifest['output_root']}/inspections") in PurePosixPath(record["path"]).parents
            and PurePosixPath(record["path"]).name == "packet.json", "Source review must bind an owned inspect packet")
    packet_bytes = inputs.read(record["path"])
    require(sha256(packet_bytes) == record["sha256"], "Stale source packet hash")
    packet = closed(inputs.json(record["path"]), ("schema_version", "status", "consumer", "profile", "cell_size",
                    "tool", "capabilities", "author_id", "inputs", "source_images", "roles", "pages"), "source packet")
    require(type(packet["schema_version"]) is int and packet["schema_version"] == 1
            and packet["status"] == "UNAPPROVED" and packet["consumer"] == manifest["id"]
            and packet["profile"] == manifest["profile"] and type(packet["cell_size"]) is int
            and packet["cell_size"] == manifest["cell_size"] and packet["author_id"] == frozen_doc["author_id"],
            "Stale/malformed source packet header")
    require(packet["capabilities"] == capabilities(manifest), "Stale/unknown explicit capability identity")
    identity = tool_identity()
    digest(review["tool_sha256"])
    require(packet["tool"] == identity and review["tool_sha256"] == identity["sha256"], "Stale source tool/dependency hash")
    header = closed(packet["inputs"], ("manifest_path", "manifest_sha256", "inventory_path", "inventory_sha256",
                    "frozen_reference_path", "frozen_reference_sha256", "licenses"), "packet protected inputs")
    for key, path in (("manifest", manifest_path), ("inventory", manifest["inventory"]),
                      ("frozen_reference", manifest["frozen_reference"])):
        require(header[f"{key}_path"] == path and header[f"{key}_sha256"] == sha256(inputs.read(path)),
                f"Stale source packet {key}")
    require(header["licenses"] == [{**r, "sha256": sha256(inputs.read(r["path"]))} for r in manifest["licenses"]],
            "Stale/mismatched source license binding")
    packet_directory = PurePosixPath(record["path"]).parent

    def image_record(info, keys, label, *, owned=True):
        closed(info, keys, label)
        path = relative_path(info["path"])
        if owned:
            require(packet_directory in PurePosixPath(path).parents, f"{label}: image not in reviewed packet")
        digest(info["sha256"])
        content = inputs.read(path)
        require(sha256(content) == info["sha256"], f"{label}: viewed image hash drift")
        return image_bytes(content, path)

    expected_full = {}
    for info in array(packet["source_images"], "full original context", True):
        image = image_record(info, ("source", "original", "path", "sha256", "dimensions"), "full original image")
        pair(info["dimensions"], "full source dimensions", 1)
        require(info["source"] in sources and info["source"] not in expected_full, "Duplicate/foreign full source")
        source = sources[info["source"]]
        require(info["original"] == source["path"] and info["sha256"] == source["sha256"]
                and list(image.size) == info["dimensions"] == list(source["image"].size), "Full original context mismatch")
        compare_visible(source["image"], image, "Full source packet context")
        expected_full[info["source"]] = info
    require(set(expected_full) == set(sources), "Incomplete original full-sheet context")
    page_map = {}
    for info in array(packet["pages"], "source pages", True):
        image = image_record(info, ("path", "sha256", "dimensions"), "source page")
        pair(info["dimensions"], "source page dimensions", 1)
        require(list(image.size) == info["dimensions"] and max(image.size) <= 2000, "Source page bounds mismatch")
        require(info["path"] not in page_map, "Duplicate source page")
        page_map[info["path"]] = info
    expected = {(pack, family["id"], role): family for pack, cat in catalogs.items()
                for family in cat["families"] for role in ROLE_ORDER}
    packets = {}
    role_keys = ("pack", "family", "role", "source", "source_path", "source_sha256", "catalog_path",
                 "catalog_sha256", "coordinate", "frozen_coordinate", "foreground", "background", "mode",
                 "candidate", "frozen", "frozen_candidate", "full_source", "page", "visible_pixels_equal")
    for entry in array(packet["roles"], "packet roles", True):
        closed(entry, role_keys, "packet role")
        key = entry["pack"], entry["family"], entry["role"]
        require(key in expected and key not in packets, "Partial/duplicate/unknown packet source role")
        family = expected[key]
        source = sources[family["source"]]
        oracle = next(r for r in frozen[key[:2]]["roles"] if r["role"] == key[2])
        pair(entry["coordinate"], "candidate coordinate")
        pair(entry["frozen_coordinate"], "frozen coordinate")
        require(entry["source"] == family["source"] and entry["source_path"] == source["path"]
                and entry["source_sha256"] == source["sha256"], "Stale source identity")
        candidate = source_tile(source["image"], family["roles"][key[2]], manifest["cell_size"])
        frozen_image = image_bytes(inputs.read(oracle["image"]), oracle["image"])
        # This comparison precedes catalog-coordinate/metadata checks. Honest updated
        # catalog/packet/review hashes cannot substitute an island for a concave hole.
        compare_visible(frozen_image, candidate, f"{key}: full source role/pixel mismatch")
        require(entry["coordinate"] == family["roles"][key[2]] and entry["frozen_coordinate"] == oracle["coordinate"],
                "Independent approved coordinates changed")
        require(all(entry[k] == family[k] for k in ("foreground", "background", "mode")), "Approved material changed")
        catalog_path = next(p["catalog"] for p in manifest["packs"] if p["id"] == key[0])
        require(entry["catalog_path"] == catalog_path and entry["catalog_sha256"] == sha256(inputs.read(catalog_path)),
                "Stale source catalog hash")
        observed = image_record(entry["candidate"], ("path", "sha256", "visible_rgba_sha256"), "candidate full-cell artwork")
        require(entry["candidate"]["visible_rgba_sha256"] == visible_digest(candidate), "Candidate visible digest drift")
        compare_visible(candidate, observed, "Candidate full role crop")
        require(entry["frozen"] == {"path": oracle["image"], "sha256": oracle["image_sha256"],
                                   "visible_rgba_sha256": oracle["visible_rgba_sha256"]}, "Independent frozen binding changed")
        frozen_copy = image_record(entry["frozen_candidate"], ("path", "sha256"), "frozen candidate")
        require(entry["frozen_candidate"]["sha256"] == oracle["image_sha256"], "Frozen candidate byte identity changed")
        compare_visible(frozen_image, frozen_copy, "Frozen candidate correspondence")
        require(entry["full_source"] == expected_full[source["id"]], "Role lacks original full-source context")
        require(type(entry["page"]) is dict and entry["page"].get("path") in page_map
                and entry["page"] == page_map[entry["page"]["path"]], "Role lacks bound source page")
        boolean(entry["visible_pixels_equal"], "packet pixel equality")
        require(entry["visible_pixels_equal"], "Packet reports differing full source artwork")
        packets[key] = entry
    require(set(packets) == set(expected), "Partial packet source-role coverage")
    require({entry["page"]["path"] for entry in packets.values()} == set(page_map), "Unbound/extra source page")
    approved = {}
    for entry in array(review["entries"], "source approval entries", True):
        closed(entry, ("binding", "observations", "verdict"), "source approval entry")
        binding = closed(entry["binding"], role_keys, "approved artwork binding")
        key = binding["pack"], binding["family"], binding["role"]
        require(key in packets and key not in approved, "Duplicate/partial/unknown source approval role")
        require(binding == packets[key], "Stale/forged source-role/page/hash/coordinate approval binding")
        observations = text(entry["observations"], "semantic source observations")
        require(len(observations.strip()) >= 20 and entry["verdict"] == "PASS", "Negative/empty semantic source approval")
        require(not test_only or "TEST-ONLY" in observations, "Synthetic trust must identify test-only observations")
        approved[key] = entry
    require(set(approved) == set(expected), "Missing/partial independent source approval coverage")
    return {"path": review_path, "sha256": sha256(inputs.read(review_path)), "reviewer": reviewer,
            "packet": record, "tool_sha256": identity["sha256"], "roles": len(approved),
            "test_only": test_only, "actual_visual_approval": not test_only}
