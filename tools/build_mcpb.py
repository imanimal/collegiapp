"""Pack Collegiapp's MCP server as a Claude Desktop extension.

Usage: python tools/build_mcpb.py [out.mcpb]

Writes Collegiapp.mcpb (or the path given): a zip of integrations/claude-desktop/manifest.json, stamped with the
version in src-tauri/tauri.conf.json, and server.js. It's the same extension the app's Add to Claude Desktop key
saves (src-tauri/src/mcp.rs); the release workflow attaches it to every release. Stdlib only.
"""

import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "integrations" / "claude-desktop"


def main() -> None:
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "Collegiapp.mcpb")
    version = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))["version"]
    manifest = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    manifest["version"] = version
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        z.write(SRC / "server.js", "server.js")
    print(f"{out} (Collegiapp {version})")


if __name__ == "__main__":
    main()
