"""Add Collegiapp's MCP server to Claude Desktop and Claude Code.

Usage: python integrations/claude-desktop/install.py [--no-desktop] [--no-code] [--remove]

Claude Desktop: adds `collegiapp` to `mcpServers` in claude_desktop_config.json, keeping everything else in it
(a copy of the file as it was goes beside it as .bak). On Windows that file is under %LOCALAPPDATA%\\Claude-Data when
Claude keeps its data outside its package, else %APPDATA%\\Claude; on a Mac, ~/Library/Application Support/Claude.
Quit Claude Desktop from its tray or menu bar icon and open it again to load the server.

Claude Code: `claude mcp add --scope user`, so every project has it.

Both run server.js from this folder with the Node on your PATH, so moving the repo means running this again.
--remove takes it out of both. Stdlib only.
"""

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
SERVER = HERE / "server.js"
NAME = "collegiapp"


def desktop_config() -> pathlib.Path:
    """The claude_desktop_config.json this Claude Desktop reads."""
    home = pathlib.Path.home()
    if sys.platform == "win32":
        local = pathlib.Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
        roaming = pathlib.Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
        # the Store build can keep its data outside its package, in Claude-Data
        outside = sorted((local / "Claude-Data").glob("claude_*/claude_desktop_config.json"))
        if outside:
            return outside[0]
        return roaming / "Claude" / "claude_desktop_config.json"
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
    return pathlib.Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")) / "Claude" / "claude_desktop_config.json"


def write_json(path: pathlib.Path, data: dict) -> None:
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def desktop(node: str, remove: bool) -> None:
    path = desktop_config()
    data = {}
    if path.exists():
        text = path.read_text(encoding="utf-8")
        data = json.loads(text) if text.strip() else {}
        shutil.copyfile(path, path.with_suffix(".json.bak"))
    servers = data.setdefault("mcpServers", {})
    if remove:
        if servers.pop(NAME, None) is None:
            print(f"Claude Desktop: no {NAME} server in {path}")
            return
    else:
        servers[NAME] = {"command": node, "args": [str(SERVER)]}
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, data)
    print(f"Claude Desktop: {'removed from' if remove else 'added to'} {path}")
    print("  Quit Claude Desktop from its tray or menu bar icon and open it again to load it.")


def code(node: str, remove: bool) -> None:
    claude = shutil.which("claude")
    if not claude:
        print("Claude Code: the claude command isn't on PATH, so it was skipped")
        return
    # `mcp add` refuses a name that's taken, so a reinstall removes the old entry first
    subprocess.run([claude, "mcp", "remove", "--scope", "user", NAME], capture_output=True, text=True)
    if remove:
        print("Claude Code: removed")
        return
    r = subprocess.run([claude, "mcp", "add", "--scope", "user", NAME, "--", node, str(SERVER)], capture_output=True, text=True)
    print("Claude Code: " + ("added for every project" if r.returncode == 0 else "not added: " + (r.stderr or r.stdout).strip()))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--no-desktop", action="store_true", help="leave Claude Desktop alone")
    ap.add_argument("--no-code", action="store_true", help="leave Claude Code alone")
    ap.add_argument("--remove", action="store_true", help="take the server out instead")
    a = ap.parse_args()
    node = shutil.which("node")
    if not node and not a.remove:
        sys.exit("Node isn't on PATH. Install it from nodejs.org (any version from 18 on), then run this again.")
    if not a.no_desktop:
        desktop(node, a.remove)
    if not a.no_code:
        code(node, a.remove)
    if not a.remove:
        print("The first time Claude uses it, Collegiapp asks you to allow the connection; click Allow there.")


if __name__ == "__main__":
    main()
