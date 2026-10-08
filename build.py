"""Build a clean zip of the extension for uploading to the Chrome Web Store.

Usage: python build.py   (on Windows: py build.py)
Output: dist/prairie-plus-<version>.zip
"""

import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Only these files ship. Anything not listed (dev notes, unused KaTeX builds,
# .ttf/.woff fonts, .DS_Store, etc.) is left out.
INCLUDE = [
    "manifest.json",
    "background.js",
    "content.js",
    "tracker.js",
    "popup.html",
    "popup.js",
    "dark-mode.css",
    "icons/icon16.png",
    "icons/icon128.png",
    "lib/katex/katex.min.js",
    "lib/katex/katex.min.css",
    "lib/katex/fonts/*.woff2",
    "LICENSE",
    "lib/katex/LICENSE",
]

# Files that are fine to be missing (included only if present).
OPTIONAL = {"LICENSE", "lib/katex/LICENSE"}


def collect_files():
    files = []
    for pattern in INCLUDE:
        matches = sorted(p for p in ROOT.glob(pattern) if p.is_file())
        if not matches and pattern not in OPTIONAL:
            sys.exit(f"error: nothing matches '{pattern}'")
        files.extend(matches)
    return files


def referenced_files(manifest):
    """Every local file the manifest (and popup.html) points to."""
    refs = set(manifest.get("icons", {}).values())
    refs.add(manifest.get("action", {}).get("default_popup", ""))
    refs.add(manifest.get("background", {}).get("service_worker", ""))
    for cs in manifest.get("content_scripts", []):
        refs.update(cs.get("js", []))
        refs.update(cs.get("css", []))
    popup = manifest.get("action", {}).get("default_popup")
    if popup:
        html = (ROOT / popup).read_text(encoding="utf-8")
        refs.update(re.findall(r'<script[^>]+src="([^"]+)"', html))
    refs.discard("")
    return refs


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]

    files = collect_files()
    names = {p.relative_to(ROOT).as_posix() for p in files}

    missing = referenced_files(manifest) - names
    if missing:
        sys.exit(f"error: referenced but not packaged: {', '.join(sorted(missing))}")

    out = ROOT / "dist" / f"prairie-plus-{version}.zip"
    out.parent.mkdir(exist_ok=True)
    out.unlink(missing_ok=True)

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            zf.write(path, path.relative_to(ROOT).as_posix())

    size_kb = out.stat().st_size / 1024
    print(f"Built {out.relative_to(ROOT)} ({len(files)} files, {size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
