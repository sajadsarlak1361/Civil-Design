#!/usr/bin/env python3
"""Flatten Desktop workflow artifacts into one directory of release files.

upload-artifact keeps the bundle layout, so a Windows artifact contains
msi/*.msi and nsis/*.exe, and a Linux artifact contains deb/ and appimage/.
softprops/action-gh-release matches installers/* only at the top of that
directory. The v0.1.0 release therefore attached the HTML page and left the
installers behind.

Each Windows bundle embeds the WebView2 offline installer, so the MSI and the
NSIS setup are each about 210 MB. Together they are the ~438 MB Actions
artifact. This script copies them out as two files. GitHub rejects a release
asset at or above 2 GiB.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

LIMIT = 2 * 1024**3
SUFFIXES = {".msi", ".exe", ".deb", ".appimage", ".html"}
REQUIRED = (".msi", ".exe", ".deb", ".appimage", "civil-design.html")


def stage(source: Path, dest: Path) -> list[Path]:
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    copied: list[Path] = []
    for path in sorted(source.rglob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix not in SUFFIXES:
            continue
        if suffix == ".html" and path.name != "civil-design.html":
            continue
        target = dest / path.name
        if target.exists():
            raise SystemExit(f"duplicate release asset name: {path.name}")
        shutil.copy2(path, target)
        copied.append(target)
    names = {path.name for path in copied}
    missing = [
        token
        for token in REQUIRED
        if token not in names and not any(name.lower().endswith(token) for name in names)
    ]
    if missing:
        found = ", ".join(sorted(names)) or "(none)"
        raise SystemExit(f"missing release assets: {', '.join(missing)}. Found: {found}")
    for path in copied:
        size = path.stat().st_size
        if size >= LIMIT:
            raise SystemExit(f"{path.name} is {size} bytes, at or above 2 GiB")
        if size == 0:
            raise SystemExit(f"{path.name} is empty")
    return copied


def main() -> None:
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "installers")
    dest = Path(sys.argv[2] if len(sys.argv) > 2 else "release-assets")
    if not source.is_dir():
        raise SystemExit(f"artifact directory not found: {source}")
    for path in stage(source, dest):
        print(f"{path.stat().st_size:12d}  {path.name}")


if __name__ == "__main__":
    main()
