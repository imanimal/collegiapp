"""Install the Collegiapp Pocket wallpaper into Wallpaper Engine.

Usage: python integrations/wallpaper-engine/install.py [--dest DIR] [--no-preview]

Copies the wallpaper (project.json, index.html, wallpaper.css, wallpaper.js) into Wallpaper Engine's
projects/myprojects/collegiapp-pocket, writes feed.js with the address of Collegiapp's presence export (presence.js
beside its store: %APPDATA%\\<identifier>, or COLLEGIAPP_DATA when set), adds Doto, Space Grotesk and Space Mono from
your installed fonts so it renders the same offline and on another PC, and draws preview.jpg (the library thumbnail)
with headless Edge or Chrome, without your Do first. Run it again after changing the wallpaper, then pick it again in
Wallpaper Engine. Stdlib only; Pillow, if present, turns the screenshot into a square JPEG.
"""

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
NAME = "collegiapp-pocket"
IDENTIFIER = "io.github.imanimal.collegiapp"  # src-tauri/tauri.conf.json, read from there when present
FILES = ["project.json", "index.html", "wallpaper.css", "wallpaper.js"]
# the file name wallpaper.css loads → patterns to look for among installed fonts
FONTS = {
    "Doto.ttf": ["Doto.ttf", "Doto*.ttf"],
    "SpaceGrotesk.ttf": ["SpaceGrotesk.ttf", "SpaceGrotesk*.ttf"],
    "SpaceMono-Regular.ttf": ["SpaceMono-Regular.ttf"],
    "SpaceMono-Bold.ttf": ["SpaceMono-Bold.ttf"],
}


def wallpaper_engine():
    """Wallpaper Engine's folder in any Steam library, or None."""
    roots = []
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as k:
            roots.append(pathlib.Path(winreg.QueryValueEx(k, "SteamPath")[0]))
    except (ImportError, OSError):
        pass
    roots.append(pathlib.Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Steam")
    libs = []
    for root in roots:
        libs.append(root)
        vdf = root / "steamapps" / "libraryfolders.vdf"
        if vdf.exists():
            for line in vdf.read_text(encoding="utf-8", errors="ignore").splitlines():
                parts = line.strip().split('"')
                if len(parts) >= 4 and parts[1] == "path":
                    libs.append(pathlib.Path(parts[3].replace("\\\\", "\\")))
    for lib in libs:
        we = lib / "steamapps" / "common" / "wallpaper_engine"
        if (we / "projects").is_dir():
            return we
    return None


def write_feed(dest):
    """feed.js: the file:// address of presence.js, which the app rewrites every 15 s (src-tauri/src/presence.rs)."""
    data = os.environ.get("COLLEGIAPP_DATA")
    if not data:
        ident = IDENTIFIER
        conf = HERE.parents[1] / "src-tauri" / "tauri.conf.json"
        if conf.exists():
            ident = json.loads(conf.read_text(encoding="utf-8")).get("identifier", ident)
        data = pathlib.Path(os.environ.get("APPDATA", pathlib.Path.home() / "AppData" / "Roaming")) / ident
    url = (pathlib.Path(data).resolve() / "presence.js").as_uri()
    (dest / "feed.js").write_text("// Written by install.py: where Collegiapp writes its presence export.\n"
                                  f"window.CA_PRESENCE = {json.dumps(url)};\n", encoding="utf-8")


def copy_fonts(dest):
    dirs = [pathlib.Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "Windows" / "Fonts",
            pathlib.Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"]
    (dest / "fonts").mkdir(exist_ok=True)
    missing = []
    for out, patterns in FONTS.items():
        found = next((f for d in dirs if d.is_dir() for p in patterns for f in sorted(d.glob(p))), None)
        if found:
            shutil.copy2(found, dest / "fonts" / out)
        else:
            missing.append(out)
    if missing:
        print("fonts not installed, using fallbacks:", ", ".join(missing), "(get them free from Google Fonts)")


def browser():
    for p in [r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe", r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
              r"%ProgramFiles%\Google\Chrome\Application\chrome.exe", r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"]:
        p = os.path.expandvars(p)
        if os.path.exists(p):
            return p
    return shutil.which("msedge") or shutil.which("chrome")


def preview(dest):
    """A square shot of the centered layout, so the library's square thumbnail shows the clock."""
    exe = browser()
    if not exe:
        print("no Edge or Chrome: skipped preview.jpg")
        return
    with tempfile.TemporaryDirectory() as tmp:
        png = pathlib.Path(tmp) / "shot.png"
        url = (dest / "index.html").as_uri() + "?preview&live=0"  # the thumbnail never shows your Do first
        subprocess.run([exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                        "--window-size=1200,1200", "--virtual-time-budget=6000", f"--user-data-dir={tmp}\\profile",
                        f"--screenshot={png}", url], capture_output=True, timeout=90)
        if not png.exists():
            print("the browser didn't write a screenshot: skipped preview.jpg")
            return
        try:
            from PIL import Image
            Image.open(png).convert("RGB").resize((600, 600), Image.LANCZOS).save(dest / "preview.jpg", quality=90)
        except ImportError:
            shutil.copy2(png, dest / "preview.png")
            proj = dest / "project.json"
            data = json.loads(proj.read_text(encoding="utf-8"))
            data["preview"] = "preview.png"
            proj.write_text(json.dumps(data, indent="\t"), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dest", type=pathlib.Path, help="install here instead of Wallpaper Engine's projects/myprojects")
    ap.add_argument("--no-preview", action="store_true", help="don't draw preview.jpg")
    args = ap.parse_args()
    dest = args.dest
    if not dest:
        we = wallpaper_engine()
        if not we:
            raise SystemExit("Wallpaper Engine not found in any Steam library; pass --dest")
        dest = we / "projects" / "myprojects" / NAME
    dest.mkdir(parents=True, exist_ok=True)
    for f in FILES:
        shutil.copy2(HERE / f, dest / f)
    write_feed(dest)
    copy_fonts(dest)
    if not args.no_preview:
        preview(dest)
    print("installed to", dest)


if __name__ == "__main__":
    main()
