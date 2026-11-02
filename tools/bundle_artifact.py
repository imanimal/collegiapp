"""Inline ui/index.html + its CSS/JS into one self-contained HTML fragment for publishing a demo.

The output has no doctype/html/head/body wrapper (the host adds those): just the <title>,
meta tags, font link, inlined <style>, the body markup and inlined <script>s.

Usage: python tools/bundle_artifact.py OUT.html
"""

import pathlib
import re
import sys

UI = pathlib.Path(__file__).resolve().parent.parent / "ui"


def main(out: str) -> None:
    html = (UI / "index.html").read_text(encoding="utf-8")
    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)

    css = "\n".join((UI / href).read_text(encoding="utf-8") for href in re.findall(r'<link rel="stylesheet" href="(css/[^"]+)">', head))
    head = re.sub(r'\s*<link rel="stylesheet" href="css/[^"]+">', "", head)
    # local font files can't travel in one HTML file; the demo uses the Google Fonts link instead
    head = re.sub(r'\s*<link rel="stylesheet" href="fonts/[^"]+">', "", head)
    head = re.sub(r'\s*<meta charset="utf-8">', "", head)

    scripts = re.findall(r'<script src="(js/[^"]+)"></script>', body)
    body = re.sub(r'\s*<script src="js/[^"]+"></script>', "", body)
    js = "\n".join(f"/* {s} */\n" + (UI / s).read_text(encoding="utf-8") for s in scripts)
    assert "</script" not in js and "</style" not in css, "inlined code must not close its own tag"

    page = f"{head.strip()}\n<style>\n{css}\n</style>\n{body.strip()}\n<script>\n{js}\n</script>\n"
    pathlib.Path(out).write_text(page, encoding="utf-8")
    print(f"wrote {out} ({len(page) // 1024} KB, {len(scripts)} scripts)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "collegiapp-demo.html")
