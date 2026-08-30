"""Deploy Trap to the OVH box.

    python deploy/deploy.py              upload changed files, build, restart
    python deploy/deploy.py --dry-run    say what would go, change nothing
    python deploy/deploy.py --status     what pm2 thinks is running
    python deploy/deploy.py --logs 40    tail the bot log
    python deploy/deploy.py --no-restart upload and build, leave the process
    python deploy/deploy.py --force      send every file, not just changed ones

The bot runs bare under pm2 at /root/trap, not in Docker, so a deploy is:
replace the sources, compile on the box, restart the process.

Four things here are deliberate.

The payload is an explicit allowlist rather than everything-minus-exclusions,
and the archive is checked for a .env before it is sent. The previous version of
this script uploaded .env, which is how a token ends up somewhere it was never
meant to be. The server's .env is the only copy that matters, and nothing here
writes to it.

src/ is removed on the server before the archive is extracted. Extracting over
the top leaves a file that was deleted locally still sitting there, still
compiled into dist, still registering its commands.

The build needs devDependencies, so this is not --omit=dev: TypeScript is a
devDependency and npx tsc is the build. It runs npm ci against the committed
lockfile rather than npm install, and package-lock.json is part of the payload.
Without that, a deploy silently re-resolves every dependency: an unpinned
@types/node moved to 22.20.1 mid-deploy and broke the build on a Buffer that
had compiled fine for weeks.

Credentials come from the environment (TRAP_PASSWORD, or TRAP_KEY for a private
key) or a prompt. Nothing is hardcoded, so this file is safe to commit.

Run it from PowerShell or cmd, not Git Bash: MSYS rewrites a TRAP_REMOTE that
starts with a slash into a Windows path, so /root/trap arrives as C:/... .
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import io
import os
import pathlib
import sys
import tarfile
import time

try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr)
    raise SystemExit(1)

HOST = os.getenv("TRAP_HOST", "51.81.67.46")
USER = os.getenv("TRAP_USER", "root")
REMOTE = os.getenv("TRAP_REMOTE", "/root/trap")
APP = "trap"

ROOT = pathlib.Path(__file__).resolve().parent.parent

PAYLOAD = [
    "src",
    "deploy",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "ecosystem.config.cjs",
    "Dockerfile",
    "docker-compose.yml",
    ".dockerignore",
    ".env.example",
    "README.md",
    "ARCHITECTURE.md",
]

NEVER = {".env", ".dbpass"}

READY = "Trap is ready"


def collect() -> "dict[str, bytes]":
    found = {}
    for entry in PAYLOAD:
        path = ROOT / entry
        if not path.exists():
            print("  skipped, missing: " + entry)
            continue
        if path.is_file():
            found[entry] = path.read_bytes()
            continue
        for child in sorted(path.rglob("*")):
            if not child.is_file() or child.suffix == ".pyc":
                continue
            if "__pycache__" in child.parts:
                continue
            found[child.relative_to(ROOT).as_posix()] = child.read_bytes()
    return found


def guard(files) -> None:
    leaked = sorted(n for n in files if pathlib.PurePosixPath(n).name in NEVER)
    if leaked:
        raise SystemExit("refusing to deploy, payload contains secrets: " + repr(leaked))


def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    key = os.getenv("TRAP_KEY")
    if key:
        client.connect(HOST, username=USER, key_filename=key, timeout=30)
        return client

    password = os.getenv("TRAP_PASSWORD") or getpass.getpass(USER + "@" + HOST + " password: ")
    client.connect(HOST, username=USER, password=password, timeout=30)
    return client


def run(client, command, seconds=900):
    _, out, _ = client.exec_command(command, timeout=seconds)
    body = out.read().decode(errors="replace")
    return out.channel.recv_exit_status(), body


def remote_digests(client):
    listing = " ".join(repr(entry) for entry in PAYLOAD)
    _, body = run(
        client,
        "cd " + REMOTE + " 2>/dev/null && find " + listing +
        " -type f 2>/dev/null -exec md5sum {} +",
    )
    digests = {}
    for line in body.splitlines():
        if "  " in line:
            digest, name = line.split("  ", 1)
            digests[name.strip()] = digest
    return digests


def changed(files, theirs):
    fresh = [
        name
        for name, body in sorted(files.items())
        if theirs.get(name) != hashlib.md5(body).hexdigest()
    ]
    stale = sorted(set(theirs) - set(files))
    return fresh, stale


def archive(files) -> bytes:
    buffer = io.BytesIO()
    stamp = int(time.time())
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, body in sorted(files.items()):
            info = tarfile.TarInfo(name)
            info.size = len(body)
            info.mtime = stamp
            info.mode = 0o644
            tar.addfile(info, io.BytesIO(body))
    return buffer.getvalue()


def upload(client, blob) -> None:
    sftp = client.open_sftp()
    try:
        handle = sftp.open("/tmp/trap-deploy.tar.gz", "wb")
        try:
            handle.write(blob)
        finally:
            handle.close()
    finally:
        sftp.close()


def configured(client) -> bool:
    """The server's .env is the only copy. Without it the bot exits 78 on boot."""
    code, _ = run(client, "test -f " + REMOTE + "/.env")
    if code != 0:
        print("no " + REMOTE + "/.env on the server. Create it first, or the bot exits 78.")
        return False
    return True


def deploy(client, build, restart, install):
    steps = [
        "mkdir -p " + REMOTE,
        "rm -rf " + REMOTE + "/src",
        "tar -xzf /tmp/trap-deploy.tar.gz -C " + REMOTE,
        "rm -f /tmp/trap-deploy.tar.gz",
    ]
    if install:
        # Decided from the payload, not the server: on a fresh box the lockfile
        # arrives with this very archive, and asking the server first picks
        # npm install and re-resolves everything.
        resolve = "npm ci" if (ROOT / "package-lock.json").exists() else "npm install"
        steps.append("cd " + REMOTE + " && " + resolve + " --no-audit --no-fund")
    if build:
        steps.append("cd " + REMOTE + " && rm -rf dist && npx tsc")

    for step in steps:
        code, body = run(client, step)
        label = step.split("&&")[-1].strip()
        if code != 0:
            print("  FAILED: " + label)
            print(body.strip()[:2000])
            return code
        print("  ok  " + label)

    if not restart:
        print("  built, process left alone")
        return 0

    log = out_log(client)
    boots = reached_ready(client, log)

    code, body = run(
        client,
        "pm2 restart " + APP + " 2>&1 || pm2 start " + REMOTE + "/ecosystem.config.cjs 2>&1",
    )
    if code != 0:
        print("  FAILED: pm2")
        print(body.strip()[:1000])
        return code

    return ready(client, log, boots)


def out_log(client) -> str:
    reader = (
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{"
        "const a=JSON.parse(s).find(x=>x.name==='" + APP + "');"
        "console.log(a?a.pm2_env.pm_out_log_path:'')})"
    )
    _, body = run(client, 'pm2 jlist | node -e "' + reader + '"')
    return body.strip()


def reached_ready(client, log) -> int:
    if not log:
        return -1
    _, body = run(client, "grep -c '" + READY + "' " + log + " 2>/dev/null || echo 0")
    digits = body.strip().splitlines()
    return int(digits[-1]) if digits and digits[-1].isdigit() else 0


def ready(client, log, boots, seconds=45):
    """Wait for a ready line this restart produced, not one an earlier boot left."""
    if boots < 0:
        print("  cannot find the pm2 log, not verifying the boot")
        return 0

    started = time.time()
    while time.time() - started < seconds:
        if reached_ready(client, log) > boots:
            _, body = run(client, "tail -40 " + log)
            lines = body.splitlines()
            last = max(i for i, line in enumerate(lines) if READY in line)
            first = next(
                (i for i in range(last, -1, -1) if "cogs:" in lines[i]),
                last,
            )
            for line in lines[first : last + 1]:
                if any(mark in line for mark in ("cogs:", "slash:", "web:", READY)):
                    print("  " + line.split(": ", 1)[-1])
            return 0

        _, state = run(client, "pm2 jlist | tr ',' '\\n' | grep -m1 status")
        if "errored" in state or "stopped" in state:
            print("  pm2 says " + state.strip())
            break
        time.sleep(2)

    _, body = run(client, "tail -25 " + log + "; tail -25 " + log.replace("-out.", "-error."))
    print("  no new ready line within " + str(seconds) + "s:")
    print(body.strip()[-2000:])
    return 1


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Deploy Trap")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--no-build", action="store_true")
    parser.add_argument("--no-restart", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--logs", nargs="?", const=40, type=int)
    args = parser.parse_args()

    files = collect()
    guard(files)

    client = connect()
    try:
        if args.status:
            print(run(client, "pm2 status")[1])
            return 0
        if args.logs:
            print(run(client, "pm2 logs " + APP + " --lines " + str(args.logs) + " --nostream 2>&1")[1])
            return 0

        theirs = remote_digests(client)
        fresh, stale = changed(files, theirs)

        total = sum(len(body) for body in files.values())
        print(str(len(files)) + " files, " + str(total // 1024) + " KB, " + str(len(fresh)) + " changed")
        for name in fresh[:25]:
            print("  + " + name)
        if len(fresh) > 25:
            print("  + " + str(len(fresh) - 25) + " more")
        for name in stale:
            print("  - " + name + " (on the server, not in the payload)")

        if args.dry_run:
            return 0
        # A stale file counts as work: nothing to upload, but it is still on the
        # server, still compiled into dist, still registering its commands.
        if not fresh and not stale and not args.force:
            print("nothing to send. --force to deploy anyway.")
            return 0
        if not configured(client):
            return 1

        upload(client, archive(files))
        return deploy(
            client,
            build=not args.no_build,
            restart=not args.no_restart,
            install="package.json" in fresh or args.force,
        )
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
