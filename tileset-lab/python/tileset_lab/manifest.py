"""Closed consumer data and descriptor-relative, no-symlink filesystem boundary."""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat


class Blocked(ValueError):
    """A prerequisite, ownership, integrity, or authoring contract failed."""


def require(condition, message):
    if not condition:
        raise Blocked(message)


def integer(value, label, minimum=0):
    require(type(value) is int and value >= minimum, f"{label}: expected integer >= {minimum}")
    return value


def text(value, label):
    require(type(value) is str and bool(value.strip()) and len(value) <= 4096,
            f"{label}: expected nonempty bounded text")
    return value


def identifier(value, label="identifier"):
    text(value, label)
    require(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value) is not None
            and len(value) <= 80, f"{label}: unsafe identifier")
    return value


def digest(value, label="sha256"):
    require(type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None,
            f"{label}: expected SHA-256")
    return value


def closed(value, keys, label):
    require(type(value) is dict and set(value) == set(keys),
            f"{label}: required/unknown fields; expected {sorted(keys)}, got "
            f"{sorted(value) if type(value) is dict else type(value).__name__}")
    return value


def array(value, label, nonempty=False):
    require(type(value) is list and (bool(value) or not nonempty), f"{label}: expected list")
    return value


def unique(values, label):
    require(len(values) == len(set(values)), f"{label}: duplicate identity")


def boolean(value, label):
    require(type(value) is bool, f"{label}: expected boolean")
    return value


def pair(value, label, minimum=0):
    array(value, label)
    require(len(value) == 2, f"{label}: expected two integers")
    for number in value:
        integer(number, label, minimum)
    return value


def rectangle(value, label):
    array(value, label)
    require(len(value) == 4, f"{label}: expected [x,y,width,height]")
    pair(value[:2], label)
    pair(value[2:], label, 1)
    return value


def relative_path(value):
    text(value, "path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and path.parts and str(path) == value
            and all(part not in (".", "..") for part in path.parts)
            and not any(c in value for c in ("\\", ":"))
            and all(ord(c) >= 32 and ord(c) != 127 for c in value),
            f"Unsafe consumer-relative path: {value!r}")
    return value


def overlaps(a, b):
    a, b = PurePosixPath(a), PurePosixPath(b)
    return a == b or a in b.parents or b in a.parents


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def parse_json(content, label):
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"{label}: duplicate JSON field {key}")
            result[key] = value
        return result

    def invalid_constant(value):
        raise Blocked(f"{label}: nonfinite JSON number {value}")

    def finite_float(value):
        number = float(value)
        require(math.isfinite(number), f"{label}: nonfinite JSON number {value}")
        return number

    try:
        return json.loads(content, object_pairs_hook=object_pairs, parse_constant=invalid_constant,
                          parse_float=finite_float)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise Blocked(f"{label}: malformed JSON: {error}") from error


class Root:
    """Hold the canonical root inode; traverse every component with O_NOFOLLOW.

    No cleanup or overwrite capability: mutations exclusively create new owned files.
    The persistent flock file is never unlinked (unlink would split competing locks).
    """

    def __init__(self, path):
        path = Path(path)
        require(path.is_absolute(), "--project-root must be absolute")
        require(str(path) == os.path.normpath(str(path)), "Noncanonical project root")
        for item in (*reversed(path.parents), path):
            require(not item.is_symlink(), f"Symlink root component: {item}")
        require(path.is_dir() and path.resolve() == path, "Missing/noncanonical project root")
        self.path = path
        self.fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.identity = self._identity(os.fstat(self.fd))
        self.created_dirs = []
        self.lock_identity = None
        self._lock_complete = False

    @staticmethod
    def _identity(info):
        return info.st_dev, info.st_ino

    def close(self):
        os.close(self.fd)

    def check_root(self):
        require(self._identity(self.path.lstat()) == self.identity and not self.path.is_symlink(),
                "Consumer root replaced during operation")
        for parent in self.path.parents:
            require(not parent.is_symlink(), f"Consumer root ancestor replaced: {parent}")
        if self.lock_identity is not None:
            info = os.stat(".tileset-lab.lock", dir_fd=self.fd, follow_symlinks=False)
            require(self._identity(info) == self.lock_identity and stat.S_ISREG(info.st_mode),
                    "Consumer lock replaced during operation")

    @contextmanager
    def parent(self, value, create=False):
        self.check_root()
        parts = PurePosixPath(relative_path(value)).parts
        fd = os.dup(self.fd)
        try:
            for index, part in enumerate(parts[:-1]):
                if create:
                    try:
                        os.mkdir(part, 0o755, dir_fd=fd)
                        self.created_dirs.append("/".join(parts[:index+1]))
                    except FileExistsError:
                        pass
                nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = nxt
            yield fd, parts[-1]
        except OSError as error:
            raise Blocked(f"Unsafe/missing path {value}: {error}") from error
        finally:
            os.close(fd)

    def check_path(self, value):
        """Validate existing components and absent future-output ancestors alike."""
        self.check_root()
        current = self.path
        for part in PurePosixPath(relative_path(value)).parts:
            current /= part
            try:
                info = current.lstat()
            except FileNotFoundError:
                continue
            require(not stat.S_ISLNK(info.st_mode), f"Symlink component: {current}")
            require(stat.S_ISDIR(info.st_mode) or current == self.path / value,
                    f"Non-directory path ancestor: {current}")
            require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode),
                    f"Special file: {current}")
        return self.path / value

    def exists(self, value):
        return self.check_path(value).exists()

    def read(self, value):
        with self.parent(value) as (fd, name):
            descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            try:
                before = os.fstat(descriptor)
                require(stat.S_ISREG(before.st_mode), f"Not a regular file: {value}")
                with os.fdopen(os.dup(descriptor), "rb") as stream:
                    content = stream.read()
                after = os.fstat(descriptor)
                require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                        (after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                        f"Input changed while reading: {value}")
                return content, self._identity(after)
            finally:
                os.close(descriptor)

    def write(self, value, content):
        with self.parent(value, create=True) as (fd, name):
            descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o644, dir_fd=fd)
            identity = self._identity(os.fstat(descriptor))
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        require(self._identity(self.check_path(value).lstat()) == identity,
                f"Output parent/file replaced during mutation: {value}")

    def mkdir(self, value):
        with self.parent(value, create=True) as (fd, name):
            os.mkdir(name, 0o755, dir_fd=fd)
            identity = self._identity(os.stat(name, dir_fd=fd, follow_symlinks=False))
            self.created_dirs.append(value)
        require(self._identity(self.check_path(value).lstat()) == identity,
                f"Output directory replaced during mutation: {value}")

    def owned_paths(self, directory):
        owner = PurePosixPath(directory)
        parents = [p for p in self.created_dirs if PurePosixPath(p) != owner
                   and owner not in PurePosixPath(p).parents]
        return sorted(set([".tileset-lab.lock", directory, *parents]))

    def files(self, directory):
        """Closed file scope, including dotfiles, rejecting links/special entries."""
        path = self.check_path(directory)
        require(path.is_dir(), f"Missing source/output directory: {directory}")
        result = []
        for base, folders, files in os.walk(path, followlinks=False):
            for name in (*folders, *files):
                item = Path(base) / name
                rel = item.relative_to(self.path).as_posix()
                self.check_path(rel)
            result.extend((Path(base) / name).relative_to(self.path).as_posix() for name in files)
        return sorted(result)

    @contextmanager
    def lock(self):
        value = ".tileset-lab.lock"
        with self.parent(value) as (fd, name):
            try:
                descriptor = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_NONBLOCK,
                                     0o600, dir_fd=fd)
                created = True
            except FileExistsError:
                descriptor = os.open(name, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                created = False
        try:
            require(stat.S_ISREG(os.fstat(descriptor).st_mode), "Foreign/special consumer lock")
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise Blocked("Consumer is locked by another operation; no lock theft") from error
            marker = b"tileset-lab consumer transaction lock v1\n"
            content = os.read(descriptor, 4096)
            require(created and content == b"" or not created and content == marker,
                    "Foreign consumer lock; ownership uncertain")
            if created:
                os.write(descriptor, marker)
                os.fsync(descriptor)
            self.lock_identity = self._identity(os.fstat(descriptor))
            self._lock_complete = False
            self.check_root()
            yield value
            # CLI performs the final root/ownership check BEFORE irreversible
            # terminal delivery; do not fail a completed reply on a later check.
            if not self._lock_complete:
                self.check_root()
        finally:
            self.lock_identity = None
            os.close(descriptor)


class Inputs:
    """Immutable byte snapshots with final content/inode replacement detection."""

    def __init__(self, root):
        self.root = root
        self.records = {}

    def read(self, path):
        if path not in self.records:
            content, identity = self.root.read(path)
            self.records[path] = (content, identity)
        return self.records[path][0]

    def json(self, path):
        return parse_json(self.read(path), path)

    def hashes(self):
        return {path: sha256(content) for path, (content, _) in sorted(self.records.items())}

    def recheck(self):
        for path, (content, identity) in self.records.items():
            current, current_identity = self.root.read(path)
            require(current_identity == identity and current == content,
                    f"Protected input changed/replaced during operation: {path}")


def load_manifest(inputs, path):
    relative_path(path)
    doc = closed(inputs.json(path), ("schema_version", "id", "profile", "cell_size", "packs",
                 "licenses", "source_roots", "originals", "sources", "inventory", "frozen_reference",
                 "source_review", "scenes", "output_root", "python_executable", "tiled_runtime"), "manifest")
    require(type(doc["schema_version"]) is int and doc["schema_version"] == 1, "Unsupported manifest version")
    identifier(doc["id"], "consumer id")
    require(doc["profile"] == "quarter-corner-v1", "Unsupported source profile")
    integer(doc["cell_size"], "cell_size", 1)
    require(doc["cell_size"] in (16, 32), "Only 16px/32px terrain cells are supported")
    for key in ("inventory", "frozen_reference", "source_review", "scenes", "output_root"):
        relative_path(doc[key])
    for key in ("python_executable", "tiled_runtime"):
        value = text(doc[key], key)
        require(Path(value).is_absolute() and Path(value).is_file() and os.access(value, os.X_OK),
                f"BLOCKED prerequisite: {key} must name an existing executable")
    for pack in array(doc["packs"], "packs", True):
        closed(pack, ("id", "catalog"), "pack")
        identifier(pack["id"], "pack id")
        relative_path(pack["catalog"])
    unique([p["id"] for p in doc["packs"]], "packs")
    unique([p["catalog"] for p in doc["packs"]], "catalog paths")
    for license in array(doc["licenses"], "licenses", True):
        closed(license, ("id", "path", "spdx", "author", "grant"), "license")
        identifier(license["id"], "license id")
        relative_path(license["path"])
        for key in ("spdx", "author", "grant"):
            text(license[key], f"license {key}")
    unique([x["id"] for x in doc["licenses"]], "licenses")
    unique([x["path"] for x in doc["licenses"]], "license paths")
    license_ids = {x["id"] for x in doc["licenses"]}
    for value in array(doc["source_roots"], "source_roots", True):
        relative_path(value)
    unique(doc["source_roots"], "source scopes")
    require(not any(overlaps(a, b) for i, a in enumerate(doc["source_roots"])
                    for b in doc["source_roots"][i + 1:]), "Overlapping source scopes")
    for original in array(doc["originals"], "originals", True):
        closed(original, ("path", "license"), "original")
        relative_path(original["path"])
        identifier(original["license"], "original license id")
        require(original["license"] in license_ids, "Original has unknown license")
        require(sum(PurePosixPath(scope) in PurePosixPath(original["path"]).parents
                    for scope in doc["source_roots"]) == 1, "Original outside declared closed source scope")
    original_paths = [x["path"] for x in doc["originals"]]
    unique(original_paths, "originals")
    require(all(x["path"] in original_paths for x in doc["licenses"]), "License missing from original inventory")
    source_ids = []
    for source in array(doc["sources"], "sources", True):
        closed(source, ("id", "pack", "path", "kind", "frame_size", "slots", "animations", "aliases"), "source")
        identifier(source["id"], "source id")
        source_ids.append(source["id"])
        identifier(source["pack"], "source pack id")
        require(source["pack"] in {p["id"] for p in doc["packs"]}, "Unknown source pack")
        relative_path(source["path"])
        require(source["path"] in original_paths and source["path"].lower().endswith(".png"),
                "Source must be an inventoried original PNG")
        require(source["kind"] in ("atlas", "sprite"), "Unknown source registration kind")
        pair(source["frame_size"], "frame_size", 1)
        for slot in array(source["slots"], "slots", True):
            closed(slot, ("id", "rect", "empty"), "slot")
            identifier(slot["id"], "slot id")
            rectangle(slot["rect"], "slot rect")
            boolean(slot["empty"], "slot empty")
            require(slot["rect"][2:] == source["frame_size"], "Partial/inconsistent complete frame geometry")
        unique([s["id"] for s in source["slots"]], "source slots")
        unique([tuple(s["rect"]) for s in source["slots"]], "slot rectangles")
        nonempty = {s["id"] for s in source["slots"] if not s["empty"]}
        for animation in array(source["animations"], "animations"):
            closed(animation, ("id", "frames"), "animation")
            identifier(animation["id"], "animation id")
            for frame in array(animation["frames"], "ordered animation frames", True):
                closed(frame, ("slot", "duration_ms", "timing"), "animation frame")
                identifier(frame["slot"], "animation slot id")
                require(frame["slot"] in nonempty, "Animation references unknown/empty slot")
                integer(frame["duration_ms"], "animation duration", 1)
                require(frame["timing"] in ("supplied", "authoring-default"), "Unknown timing provenance")
                require(frame["timing"] != "authoring-default" or frame["duration_ms"] == 100,
                        "Authoring default must be materialized as 100ms")
        for alias in array(source["aliases"], "aliases"):
            closed(alias, ("id", "target"), "frame alias")
            identifier(alias["id"], "alias id")
            identifier(alias["target"], "alias target id")
            require(alias["target"] in nonempty, "Alias must directly target a registered nonempty frame")
        unique([s["id"] for s in source["slots"]] + [a["id"] for a in source["animations"]]
               + [a["id"] for a in source["aliases"]], "frame/animation/alias identities")
        require(source["kind"] == "sprite" or not source["animations"] and not source["aliases"],
                "Atlas registrations cannot declare sprite animations/aliases")
    unique(source_ids, "source ids")
    unique([s["path"] for s in doc["sources"]], "PNG registrations")
    require({s["path"] for s in doc["sources"]} == {p for p in original_paths if p.lower().endswith(".png")},
            "Entire original PNG inventory must be registered exactly once")
    protected = [path, doc["inventory"], doc["frozen_reference"], doc["source_review"], doc["scenes"],
                 *doc["source_roots"], *original_paths, *(p["catalog"] for p in doc["packs"])]
    for key in ("python_executable", "tiled_runtime"):
        executable = Path(doc[key]).resolve()
        if executable.is_relative_to(inputs.root.path):
            protected.append(executable.relative_to(inputs.root.path).as_posix())
    require(not any(overlaps(doc["output_root"], value) for value in protected),
            "Output/input same-path or ancestor/descendant overlap")
    record_paths = [path, doc["inventory"], doc["frozen_reference"], doc["source_review"], doc["scenes"],
                    *(p["catalog"] for p in doc["packs"])]
    require(not any(overlaps(a, b) for i, a in enumerate(record_paths) for b in record_paths[i + 1:]),
            "Aliased consumer records")
    require(not any(overlaps(a, b) for a in record_paths for b in doc["source_roots"]),
            "Consumer records overlap original scope")
    for value in protected + [doc["output_root"]]:
        inputs.root.check_path(value)
    return doc
