#!/usr/bin/env python3
"""Build a reproducible plugin ZIP from an explicit allowlist of distributable files.

  python3 scripts/package_plugin.py [--output-dir dist]

Writes dist/mosofin-<version>.zip and a .sha256 beside it. Tests, docs and
CI files are not shipped; the runtime ships only the files listed below.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = (".claude-plugin/plugin.json", ".grok-plugin/plugin.json", ".mcp.json", "README.md", "LICENSE")
CONTENT_DIRS = ("skills", "agents", "assets", "runtime")
CONTENT_SUFFIXES = {".md", ".json", ".svg", ".png"}
RUNTIME_FILES = {"connect.cjs", "connection-server.mjs", "conversation-auth.mjs", "oauth-helper.cjs", "callback-page.cjs", "callback.html"}


def collect(root: Path) -> list[Path]:
    manifest = json.loads((root / ROOT_FILES[0]).read_text())
    grok = json.loads((root / ".grok-plugin/plugin.json").read_text())
    if manifest != grok:
        raise ValueError(".claude-plugin/plugin.json and .grok-plugin/plugin.json must be identical")
    for marketplace in (".claude-plugin/marketplace.json", ".grok-plugin/marketplace.json"):
        entry = next(p for p in json.loads((root / marketplace).read_text())["plugins"] if p["name"] == manifest["name"])
        if entry.get("version") != manifest["version"]:
            raise ValueError(f"{marketplace} lists {entry.get('version')}, plugin.json is {manifest['version']}")
    if not re.fullmatch(r"[a-z][a-z0-9-]*", manifest["name"]):
        raise ValueError("Invalid plugin name")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?", manifest["version"]):
        raise ValueError("Invalid release version")

    paths = [root / item for item in ROOT_FILES]
    for directory in CONTENT_DIRS:
        base = root / directory
        if base.is_symlink():
            raise ValueError(f"Refusing symlink: {base}")
        for path in sorted(base.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"Refusing symlink: {path}")
            if not path.is_file():
                continue
            relative = path.relative_to(root)
            if any(part.startswith(".") for part in relative.parts):
                raise ValueError(f"Unexpected hidden file: {relative}")
            allowed = path.name in RUNTIME_FILES if directory == "runtime" else path.suffix in CONTENT_SUFFIXES
            if not allowed:
                raise ValueError(f"Unexpected content file: {relative}")
            paths.append(path)
    missing = RUNTIME_FILES - {p.name for p in paths if p.parent.name == "runtime"}
    if missing:
        raise ValueError(f"Missing runtime files: {sorted(missing)}")
    if not any(p.name == "SKILL.md" for p in paths):
        raise ValueError("No skills found")
    for path in paths:
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
            raise ValueError(f"Invalid distributable path: {path}")
    return paths


def package(output_dir: Path, root: Path = ROOT) -> Path:
    root = root.resolve()
    manifest = json.loads((root / ROOT_FILES[0]).read_text())
    paths = collect(root)
    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / f"{manifest['name']}-{manifest['version']}.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(paths):
            info = zipfile.ZipInfo(path.relative_to(root).as_posix(), (2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            bundle.writestr(info, path.read_bytes())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(f"{digest}  {archive.name}\n")
    print(f"{archive} ({len(paths)} files, SHA256 {digest})")
    return archive


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    package(parser.parse_args().output_dir)
