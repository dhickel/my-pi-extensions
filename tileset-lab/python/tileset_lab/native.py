"""Existing Tiled capability, bounded complete logs, owned synchronous processes.

No installation, offscreen route, detached jobs, or implicit source approval.
The CLI establishes its group before release; every native descendant stays in
that group. Ordinary library callers still own/await each direct subprocess.
"""
from __future__ import annotations

from contextlib import contextmanager
import ctypes
import os
from pathlib import Path
import platform
import re
import selectors
import signal
import stat
import subprocess
import time
import uuid

from .manifest import Blocked, closed, identifier, json_bytes, parse_json, require, sha256

LOG_LIMIT = 16*1024*1024
ERROR = re.compile(r"\b(?:Error|Exception):|\b(?:SyntaxError|ReferenceError|TypeError|RangeError|uncaught)\b|Stack traceback:|At line [0-9]+|failed to (?:load|read|write)|not found", re.I)
_CHILDREN = set()
_TERMINAL_COMPLETE = False


class Cancelled(KeyboardInterrupt):
    pass


def _group_members():
    pgid = os.getpgrp()
    if pgid != os.getpid():
        return []
    members = []
    for path in Path("/proc").glob("[0-9]*/stat"):
        try:
            fields = path.read_text().rsplit(")", 1)[1].split()
            pid = int(path.parent.name)
            if int(fields[2]) == pgid and pid != os.getpid():
                members.append(pid)
        except (OSError, ValueError, IndexError):
            continue
    return members


@contextmanager
def defer_cancellation():
    """Deliver pending INT/TERM only after a small ownership transition settles."""
    previous = signal.pthread_sigmask(signal.SIG_BLOCK, (signal.SIGINT, signal.SIGTERM))
    try:
        yield
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous)


@contextmanager
def owned_settlement():
    """Enter INSIDE the consumer lock so every exit settles before unlocking."""
    try:
        yield
    finally:
        if not _TERMINAL_COMPLETE:
            settle_owned()


def complete_delivery(deliver):
    """Last operation: deliver a terminal result after all checks/settlement.

    Cancellation pending BEFORE delivery still fails. Once the complete reply
    has flushed, the operation is complete; a late signal cannot turn already
    delivered publication into a cancellation or reopen its rollback boundary.
    """
    global _TERMINAL_COMPLETE
    with defer_cancellation():
        require(not _group_members() and not _CHILDREN, "Terminal delivery before owned settlement")
        if signal.sigpending() & {signal.SIGINT, signal.SIGTERM}:
            raise Cancelled("Invocation cancelled before terminal delivery")
        deliver()
        _TERMINAL_COMPLETE = True


def settle_owned():
    # Cancellation during TERM/grace/KILL must not unwind the consumer lock.
    # Pending cancellation is delivered after pipes, descendants and reaping.
    with defer_cancellation():
        _settle_owned()


def _settle_owned():
    """TERM/grace/KILL, await every Popen and pipe; never signal a parent group."""
    members = _group_members()
    for pid in members:
        try:
            if os.getpgid(pid) == os.getpid():
                os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for child in tuple(_CHILDREN):
        if child.poll() is None:
            child.terminate()
    deadline = time.monotonic()+2
    while (any(child.poll() is None for child in _CHILDREN) or _group_members()) and time.monotonic() < deadline:
        time.sleep(.02)
    for pid in _group_members():
        try:
            if os.getpgid(pid) == os.getpid():
                os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    for child in tuple(_CHILDREN):
        if child.poll() is None:
            child.kill()
        child.communicate()
        _CHILDREN.discard(child)
    # Invocation CLI is a Linux subreaper: orphaned owned grandchildren are
    # adopted here, so cancellation awaits/reaps them rather than trusting PID1.
    deadline = time.monotonic()+2
    while _group_members() and time.monotonic() < deadline:
        for pid in _group_members():
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass
        time.sleep(.01)
    require(not _group_members(), "Owned descendants did not settle; no success/publication claim")


@contextmanager
def invocation_group():
    """Private Node-compatible readiness on inherited FD, release on another FD.

    Without those two FDs, direct CLI execution starts immediately. No descendant
    can start before this function establishes and announces the owned PGID.
    """
    global _TERMINAL_COMPLETE
    _TERMINAL_COMPLETE = False
    old = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM)}
    libc = ctypes.CDLL(None, use_errno=True)
    previous_subreaper = ctypes.c_int()
    require(libc.prctl(37, ctypes.byref(previous_subreaper), 0, 0, 0) == 0,
            "Could not read Linux invocation subreaper ownership")
    require(libc.prctl(36, 1, 0, 0, 0) == 0, "Could not establish owned descendant reaping")
    def abort(signum, frame):
        if not _TERMINAL_COMPLETE:
            raise Cancelled(f"Invocation cancelled by signal {signum}")
    try:
        if os.getpgrp() != os.getpid():
            os.setpgid(0, 0)
        require(os.getpgrp() == os.getpid(), "Could not establish invocation-owned process group")
        for s in old:
            signal.signal(s, abort)
        ready = os.environ.get("TILESET_LAB_READY_FD")
        release = os.environ.get("TILESET_LAB_RELEASE_FD")
        require((ready is None) == (release is None), "Incomplete private readiness handshake")
        if ready is not None:
            require(ready.isdecimal() and release.isdecimal() and int(ready) >= 3 and int(release) >= 3 and ready != release,
                    "Invalid private handshake descriptors")
            os.write(int(ready), json_bytes({"schema_version": 1, "pid": os.getpid(), "pgid": os.getpgrp(), "status": "READY"}))
            os.close(int(ready))
            with os.fdopen(int(release), "rb", buffering=0) as stream:
                require(stream.read(8) == b"RELEASE\n", "Invocation was not released by owner")
        yield {"pid": os.getpid(), "pgid": os.getpgrp()}
    finally:
        # Settlement defers, rather than discards, a pending cancellation.
        try:
            if not _TERMINAL_COMPLETE:
                settle_owned()
        finally:
            libc.prctl(36, previous_subreaper.value, 0, 0, 0)
            # CLI terminal delivery is irreversible. Keep its completed-state
            # handler through root close/SystemExit, so late TERM cannot change
            # a delivered terminal result into a signalled transport exit.
            if not _TERMINAL_COMPLETE:
                for s, handler in old.items():
                    signal.signal(s, handler)


def _environment(root, directory, launcher):
    require(platform.system() == "Linux" and platform.machine() == "x86_64", "Authorized native platform is Linux x86_64 only")
    env = os.environ.copy()
    require(bool(env.get("DISPLAY")), "BLOCKED prerequisite: existing authorized X display; no offscreen fallback")
    env["QT_QPA_PLATFORM"] = "xcb"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    for key in ("QT_PLUGIN_PATH", "QT_QPA_PLATFORM_PLUGIN_PATH", "QML2_IMPORT_PATH", "LD_PRELOAD"):
        env.pop(key, None)
    for kind in ("config", "data"):
        value = f"{directory}/{kind}"
        root.mkdir(value)
        # Clone the existing caller/runtime configuration; never edit its files.
        source = Path(os.environ.get(f"XDG_{kind.upper()}_HOME", str(launcher.parent.parent/kind)))
        if source.is_dir():
            for p in sorted(source.rglob("*")):
                require(not p.is_symlink(), "Configuration clone has uncertain symlink ownership")
                if p.is_file():
                    root.write(f"{value}/{p.relative_to(source).as_posix()}", p.read_bytes())
        env[f"XDG_{kind.upper()}_HOME"] = str(root.check_path(value))
    return env


def _open_log(root, path):
    with root.parent(path, create=True) as (fd, name):
        descriptor = os.open(name, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o644, dir_fd=fd)
    return os.fdopen(descriptor, "wb")


def run_owned(root, command, environment, log_prefix, *, sentinel=None, timeout=1800, accept_error=False):
    """Parse all bounded stdout/stderr, including anything AFTER a success line."""
    root.check_root()
    command = [str(value) for value in command]
    files = {"stdout": f"{log_prefix}.stdout.log", "stderr": f"{log_prefix}.stderr.log"}
    chunks = {key: bytearray() for key in files}
    overflow = False
    child = None
    with _open_log(root, files["stdout"]) as out, _open_log(root, files["stderr"]) as err:
        streams = {"stdout": out, "stderr": err}
        try:
            child = subprocess.Popen(command, cwd=root.path, env=environment, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, close_fds=True)
            _CHILDREN.add(child)
            root.write(f"{log_prefix}.owner.json", json_bytes({"pid": child.pid, "pgid": os.getpgid(child.pid),
                       "parent_pid": os.getpid(), "argv": command, "detached": False}))
            require(os.getpgid(child.pid) == os.getpgrp(), "Native descendant escaped invocation group")
            deadline = time.monotonic()+timeout
            with selectors.DefaultSelector() as selector:
                for key in files:
                    pipe = getattr(child, key)
                    os.set_blocking(pipe.fileno(), False)
                    selector.register(pipe, selectors.EVENT_READ, key)
                while selector.get_map():
                    require(time.monotonic() < deadline, "Native timeout; ownership settled before return")
                    root.check_root()
                    for event, _ in selector.select(.1):
                        data = os.read(event.fd, 65536)
                        if not data:
                            selector.unregister(event.fileobj)
                            event.fileobj.close()
                            continue
                        key = event.data
                        room = LOG_LIMIT-len(chunks[key])
                        if len(data) > room:
                            overflow = True
                            data = data[:max(0, room)]
                            if child.poll() is None:
                                child.terminate()
                            deadline = min(deadline, time.monotonic()+2)
                        chunks[key].extend(data)
                        streams[key].write(data)
                returncode = child.wait(timeout=2)
            for stream in streams.values():
                stream.flush()
                os.fsync(stream.fileno())
        except BaseException:
            # Settle the entire owned group BEFORE draining pipes; otherwise an
            # orphan holding a pipe could make communicate wait indefinitely.
            settle_owned()
            raise
        finally:
            if child is not None and child.poll() is not None:
                _CHILDREN.discard(child)
            if child is not None:
                for key in files:
                    pipe = getattr(child, key)
                    if pipe and not pipe.closed:
                        pipe.close()
    require(not overflow, "Native log overflow/truncation prevents complete error proof")
    try:
        text = {key: bytes(value).decode("utf-8", errors="strict") for key, value in chunks.items()}
    except UnicodeError as error:
        raise Blocked("Malformed native log encoding") from error
    result = {"argv": command, "returncode": returncode, "logs": {
        key: {"path": path, "size_bytes": len(chunks[key]), "sha256": sha256(bytes(chunks[key]))} for key, path in files.items()},
        "sentinel": sentinel, "overflow": False, "complete": True}
    root.write(f"{log_prefix}.command.json", json_bytes(result))
    if not accept_error:
        require(returncode == 0, f"Native abnormal exit {returncode}; see {log_prefix}")
        require(not any(ERROR.search(value) for value in text.values()), f"Native error anywhere in complete logs; see {log_prefix}")
        if sentinel is not None:
            require_native_sentinel(text["stdout"], text["stderr"], sentinel)
    return result, text


def require_native_sentinel(stdout, stderr, sentinel):
    require(not ERROR.search(stdout) and not ERROR.search(stderr), "Native error before/after apparent success")
    lines = stdout.splitlines()
    require(lines and lines[-1] == sentinel and sum(line == sentinel for line in lines) == 1
            and stdout.count(sentinel) == 1 and sentinel not in stderr,
            "Missing/duplicate/nonterminal/nonexact run-specific native sentinel")


def runtime_content(launcher):
    """Actual relevant installed binary/library and resolved host dependency bytes."""
    launcher = Path(launcher)
    folder = launcher.parent
    require(launcher.name == "AppRun" and (folder/"usr/bin/tiled").is_file(), "Explicit existing extracted Tiled AppRun required")
    paths = [launcher, *sorted((folder/"usr/bin").glob("*")),
             *sorted((folder/"usr/lib").glob("*.so*")), *sorted((folder/"usr/plugins").rglob("*.so"))]
    paths = [p for p in paths if p.is_file()]
    records = {str(p): {"size_bytes": p.stat().st_size, "sha256": sha256(p.read_bytes())} for p in paths}
    for program in (folder/"usr/bin/tiled", folder/"usr/bin/tmxrasterizer", folder/"usr/plugins/platforms/libqxcb.so"):
        # ldd is a bounded synchronous diagnostic; it does not start native GUI work.
        process = subprocess.run(["/usr/bin/ldd", str(program)], capture_output=True, timeout=15, check=False)
        require(process.returncode == 0 and b"not found" not in process.stdout+process.stderr, "Native unresolved dependencies")
        for match in re.finditer(rb"(?:=>\s*)?(/[^\s()]+)", process.stdout):
            p = Path(os.fsdecode(match[1])).resolve()
            if p.is_file():
                records[str(p)] = {"size_bytes": p.stat().st_size, "sha256": sha256(p.read_bytes())}
    core = {"platform": platform.platform(), "machine": platform.machine(), "route": "xcb",
            "display": os.environ.get("DISPLAY"), "launcher": str(launcher), "files": records}
    return {**core, "sha256": sha256(json_bytes(core))}


def prepare_runtime(root, manifest, directory):
    launcher = Path(manifest["tiled_runtime"])
    root.mkdir(directory)
    environment = _environment(root, directory, launcher)
    result, text = run_owned(root, [launcher, "--version"], environment, f"{directory}/version", timeout=30)
    require(text["stdout"].strip() == "Tiled 1.12.2", "Actual native version is not Tiled 1.12.2")
    identity = runtime_content(launcher)
    identity["version"] = "1.12.2"
    identity["version_command"] = result
    root.write(f"{directory}/identity.json", json_bytes(identity))
    return environment, identity


def evaluate(root, manifest, environment, directory, resource, plan):
    path = Path(__file__).parent/"resources"/resource
    require(path.is_file(), "Missing packaged native resource")
    token = uuid.uuid4().hex
    sentinel = f"TILESET_LAB_NATIVE_PASS {token} {resource}"
    args = [manifest["tiled_runtime"], "--new-instance", "--disable-opengl", "--evaluate", path,
            root.path, root.path/plan, token]
    result, _ = run_owned(root, args, environment, f"{directory}/{resource}", sentinel=sentinel)
    return result


def render_candidate(inputs, manifest, manifest_path, candidate_id, *, allow_test_trust=False):
    from .validate import prepare_render, finish_render
    require(inputs.root.lock_identity is not None, "Whole-consumer lock required for render")
    require(os.getpgrp() == os.getpid(), "Native render must have invocation-owned PGID before descendants")
    identifier(candidate_id, "candidate id")
    state = prepare_render(inputs, manifest, manifest_path, candidate_id, allow_test_trust=allow_test_trust)
    root, directory = inputs.root, state["native_directory"]
    environment, runtime = prepare_runtime(root, manifest, f"{directory}/runtime")
    draw_command = evaluate(root, manifest, environment, directory, "native_draw.js", state["draw_plan_path"])
    render_command = evaluate(root, manifest, environment, directory, "native_render.js", state["render_plan_path"])
    animation_commands = []
    for item in state["contexts"]:
        if not item["elapsed_ms"]:
            continue
        prefix = f"{directory}/animation/{item['key']}"
        # Rasterizer performs the real Tile::advanceAnimation at the requested
        # elapsed interval. Frame 0 and frame 1 are both retained, never relabeled.
        result, _ = run_owned(root, [manifest["tiled_runtime"], "tmxrasterizer", "--no-smoothing",
                             "--frames", "2", "--frame-duration", str(item["elapsed_ms"]),
                             root.path/item["map"], root.path/(prefix+".png")], environment,
                             f"{directory}/logs/animation-{item['key']}")
        require(root.exists(prefix+"0.png") and root.exists(prefix+"1.png"), "Incomplete actual native animation exports")
        animation_commands.append({"key": item["key"], "command": result, "zero": prefix+"0.png", "actual": prefix+"1.png"})
    inputs.recheck()
    current = runtime_content(manifest["tiled_runtime"])
    require(current["sha256"] == runtime["sha256"], "Native runtime/dependencies changed during render")
    return finish_render(inputs, manifest, manifest_path, state, runtime, draw_command, render_command, animation_commands)
