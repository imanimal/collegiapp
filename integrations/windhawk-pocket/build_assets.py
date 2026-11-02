"""Renders the images the Windhawk styles paint onto the shell: the Start key (normal, hover and down), the deck's
engraving with its speaker grille, the label bands with their pixel icons (Start, quick settings, notifications,
calendar) and small key icons. Windhawk can't add text or pixel art to a stock button, so these pieces of the canvas
design come in as image brushes.

Usage: python integrations/windhawk-pocket/build_assets.py [--scale 1.25] [--cream]
--scale is the display scale (Settings › System › Display › Scale). Images are drawn at device pixels so the pixel
icon stays crisp. Needs Pillow and the Pocket fonts installed (see integrations/windows-pocket/README.md)."""
import argparse
import os
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONTS = [Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Windows/Fonts", Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"]

# 9×9 pixel icons from the design canvas (same paths as Collegiapp's icon set).
START = "M0 0h4v1h-4zM5 0h4v1h-4zM0 1h4v1h-4zM5 1h4v1h-4zM0 2h4v1h-4zM5 2h4v1h-4zM0 3h4v1h-4zM5 3h4v1h-4zM0 5h4v1h-4zM5 5h4v1h-4zM0 6h4v1h-4zM5 6h4v1h-4zM0 7h4v1h-4zM5 7h4v1h-4zM0 8h4v1h-4zM5 8h4v1h-4z"
ICONS = {
    "pin": "M2 0h5v1h-5zM1 1h1v1h-1zM7 1h1v1h-1zM0 2h1v1h-1zM3 2h3v1h-3zM8 2h1v1h-1zM0 3h1v1h-1zM3 3h1v1h-1zM5 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM3 4h3v1h-3zM8 4h1v1h-1zM1 5h1v1h-1zM7 5h1v1h-1zM2 6h1v1h-1zM6 6h1v1h-1zM3 7h1v1h-1zM5 7h1v1h-1zM4 8h1v1h-1z",
    "now": "M5 0h3v1h-3zM4 1h3v1h-3zM3 2h3v1h-3zM2 3h6v1h-6zM5 4h2v1h-2zM4 5h2v1h-2zM3 6h2v1h-2zM2 7h2v1h-2zM1 8h2v1h-2z",
    "start": START,
    "gear": "M4 0h1v1h-1zM1 1h1v1h-1zM3 1h3v1h-3zM7 1h1v1h-1zM2 2h5v1h-5zM1 3h2v1h-2zM6 3h2v1h-2zM0 4h3v1h-3zM6 4h3v1h-3zM1 5h2v1h-2zM6 5h2v1h-2zM2 6h5v1h-5zM1 7h1v1h-1zM3 7h3v1h-3zM7 7h1v1h-1zM4 8h1v1h-1z",
    "folder": "M0 1h4v1h-4zM0 2h9v1h-9zM0 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1zM0 7h9v1h-9z",
    "power": "M4 0h1v1h-1zM1 1h1v1h-1zM4 1h1v1h-1zM7 1h1v1h-1zM0 2h1v1h-1zM4 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM4 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM1 6h1v1h-1zM7 6h1v1h-1zM2 7h5v1h-5z",
    "lab": "M1 0h1v1h-1zM4 0h1v1h-1zM7 0h1v1h-1zM0 1h3v1h-3zM4 1h1v1h-1zM7 1h1v1h-1zM1 2h1v1h-1zM4 2h1v1h-1zM7 2h1v1h-1zM1 3h1v1h-1zM4 3h1v1h-1zM6 3h3v1h-3zM1 4h1v1h-1zM4 4h1v1h-1zM7 4h1v1h-1zM1 5h1v1h-1zM3 5h3v1h-3zM7 5h1v1h-1zM1 6h1v1h-1zM4 6h1v1h-1zM7 6h1v1h-1zM1 7h1v1h-1zM4 7h1v1h-1zM7 7h1v1h-1zM1 8h1v1h-1zM4 8h1v1h-1zM7 8h1v1h-1z",
    "bell": "M4 0h1v1h-1zM3 1h3v1h-3zM2 2h5v1h-5zM2 3h5v1h-5zM2 4h5v1h-5zM1 5h7v1h-7zM0 6h9v1h-9zM4 8h1v1h-1z",
    "week": "M2 0h1v1h-1zM6 0h1v1h-1zM0 1h9v1h-9zM0 2h9v1h-9zM0 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM2 4h1v1h-1zM4 4h1v1h-1zM6 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM2 6h1v1h-1zM4 6h1v1h-1zM8 6h1v1h-1zM0 7h1v1h-1zM8 7h1v1h-1zM0 8h9v1h-9z",
    "search": "M2 0h3v1h-3zM1 1h1v1h-1zM5 1h1v1h-1zM0 2h1v1h-1zM6 2h1v1h-1zM0 3h1v1h-1zM6 3h1v1h-1zM0 4h1v1h-1zM6 4h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1zM2 6h4v1h-4zM6 7h2v1h-2zM7 8h2v1h-2z",
}

NIGHT = dict(accent="#ff6a2b", on_accent="#1b1915", text="#f4efe5", text2="#d0c9ba", text3="#a39c8d", chrome="#0f0e0d")
CREAM = dict(accent="#ff5b1f", on_accent="#1b1915", text="#1b1915", text2="#4a453c", text3="#6a645a", chrome="#2a2722")


def font(name, size, weight=None):
    for d in FONTS:
        p = d / name
        if p.exists():
            f = ImageFont.truetype(str(p), size)
            if weight:  # variable fonts (Space Grotesk): pick the weight on the wght axis
                try:
                    f.set_variation_by_axes([weight])
                except (OSError, ValueError):
                    pass
            return f
    raise SystemExit(f"Font {name} isn't installed; see integrations/windows-pocket/README.md")


def rgb(hex_, a=255):
    h = hex_.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


def mix(a, b, t):
    """t of colour a, the rest of b (like CSS color-mix)."""
    return tuple(round(x * t + y * (1 - t)) for x, y in zip(rgb(a)[:3], rgb(b)[:3])) + (255,)


def pixels(path):
    for x, y, w in re.findall(r"M(\d+) (\d+)h(\d+)", path):
        yield int(x), int(y), int(w)


def rounded(size, box, radius, fill, ss=4):
    """A supersampled rounded rectangle on a transparent layer, so the corners are smooth."""
    w, h = size
    big = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    x0, y0, x1, y1 = box
    if callable(fill):  # vertical gradient
        mask = Image.new("L", big.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((x0 * ss, y0 * ss, x1 * ss - 1, y1 * ss - 1), radius * ss, fill=255)
        grad = Image.new("RGBA", big.size)
        gd = ImageDraw.Draw(grad)
        for y in range(big.height):
            gd.line((0, y, big.width, y), fill=fill(max(0.0, min(1.0, (y - y0 * ss) / max(1, (y1 - y0) * ss)))))
        big = Image.composite(grad, big, mask)
    else:
        d.rounded_rectangle((x0 * ss, y0 * ss, x1 * ss - 1, y1 * ss - 1), radius * ss, fill=fill)
    return big.resize(size, Image.LANCZOS)


def start_key(pal, s, state):
    """The B8 primary key from the canvas: orange gradient, 1 px ring, 3 px lip, pixel icon and 'Start'."""
    w, h = round(88 * s), round(40 * s)
    lip = round(3 * s)
    r = round(10 * s)
    acc = pal["accent"]
    top = mix("#ffffff", acc, 0.26 if state == "hover" else 0.16)
    bottom = mix("#ffffff", acc, 0.08) if state == "hover" else rgb(acc)
    ring, lipc = mix(acc, "#000000", 0.62), mix(acc, "#000000", 0.52)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    y0 = lip if state == "down" else 0
    if state != "down":
        img.alpha_composite(rounded((w, h), (0, lip, w, h), r, lipc))
    img.alpha_composite(rounded((w, h), (0, y0, w, y0 + h - lip), r, ring))
    grad = lambda t: tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    img.alpha_composite(rounded((w, h), (1, y0 + 1, w - 1, y0 + h - lip - 1), r - 1, grad))
    # content: icon, 8 px gap, label; centred on the key's face
    d = ImageDraw.Draw(img)
    px = 2  # icon pixel size in device pixels: 18 px icon at 1.25×
    f = font("SpaceGrotesk.ttf", round(14 * s), 600)
    label = "Start"
    tw = d.textlength(label, font=f)
    gap = round(8 * s)
    cw = 9 * px + gap + tw
    cx = (w - cw) / 2
    face = h - lip
    iy = y0 + (face - 9 * px) // 2
    ix = round(cx)
    for x, y, n in pixels(START):
        d.rectangle((ix + x * px, iy + y * px, ix + (x + n) * px - 1, iy + (y + 1) * px - 1), fill=rgb(pal["on_accent"]))
    asc, desc = f.getmetrics()
    d.text((round(cx + 9 * px + gap), y0 + (face - (asc + desc)) / 2 + 1), label, font=f, fill=rgb(pal["on_accent"]))
    return img


def engraving(pal, s):
    """The deck's printed model name and speaker grille, which sit left of the tray on the canvas."""
    h = round(48 * s)
    f = font("SpaceMono-Bold.ttf", round(9.5 * s))
    label = "POCKET CA-1"
    track = 0.22 * 9.5 * s
    widths = [ImageDraw.Draw(Image.new("L", (1, 1))).textlength(c, font=f) for c in label]
    tw = sum(widths) + track * (len(label) - 1)
    gw, gh = round(92 * s), round(27 * s)  # three full rows of dots
    gap, tail = round(14 * s), round(12 * s)
    w = round(tw + gap + gw + tail)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    asc, desc = f.getmetrics()
    x, y = 0.0, (h - (asc + desc)) / 2
    for c, cw in zip(label, widths):
        d.text((x, y), c, font=f, fill=rgb(pal["text3"], round(255 * 0.8)))
        x += cw + track
    # grille: a 9 px grid of 1.7 px dots, drawn supersampled
    ss = 4
    g = Image.new("RGBA", (gw * ss, gh * ss), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    step, rad = 9 * s * ss, 1.95 * s * ss
    col = rgb(pal["text"], round(255 * 0.55 * 0.5))
    yy = step / 2
    while yy < gh * ss:
        xx = step / 2
        while xx < gw * ss:
            gd.ellipse((xx - rad, yy - rad, xx + rad, yy + rad), fill=col)
            xx += step
        yy += step
    g = g.resize((gw, gh), Image.LANCZOS)
    img.alpha_composite(g, (round(tw + gap), (h - gh) // 2))
    return img


def icon(path, colour, px=2):
    """A 9×9 pixel icon at px device pixels per icon pixel (18 px, 14.4 DIP at 1.25×)."""
    img = Image.new("RGBA", (9 * px, 9 * px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for x, y, n in pixels(path):
        d.rectangle((x * px, y * px, (x + n) * px - 1, (y + 1) * px - 1), fill=rgb(colour))
    return img


def band(fill, icon_path, icon_colour, s):
    """A label band's background: the band colour with its pixel icon at the left, wide enough for any band.
    It is exactly 38.4 DIP tall at 1.25×, so UniformToFill draws it 1:1 and the icon stays crisp."""
    h = round(38.4 * s)
    img = Image.new("RGBA", (round(1920 * s), h), rgb(fill))
    ic = icon(icon_path, icon_colour)
    img.alpha_composite(ic, (round(14 * s), (h - ic.height) // 2))
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=1.25)
    ap.add_argument("--cream", action="store_true")
    a = ap.parse_args()
    pal = CREAM if a.cream else NIGHT
    out = HERE / "assets"
    out.mkdir(exist_ok=True)
    for state, name in (("normal", "start-key"), ("hover", "start-key-hover"), ("down", "start-key-down")):
        start_key(pal, a.scale, state).save(out / f"{name}.png")
    e = engraving(pal, a.scale)
    e.save(out / "engraving.png")
    # Start: band backgrounds and key icons
    band(pal["chrome"], ICONS["pin"], pal["accent"], a.scale).save(out / "band-pinned.png")
    band(pal["chrome"], ICONS["start"], pal["accent"], a.scale).save(out / "band-all.png")
    band(pal["accent"], ICONS["now"], pal["on_accent"], a.scale).save(out / "band-dofirst.png")
    icon(ICONS["power"], pal["accent"]).save(out / "icon-power.png")
    # Quick settings, notifications and calendar bands
    band(pal["chrome"], ICONS["lab"], pal["accent"], a.scale).save(out / "band-quick.png")
    band(pal["chrome"], ICONS["bell"], pal["accent"], a.scale).save(out / "band-notes.png")
    band(pal["chrome"], ICONS["week"], pal["accent"], a.scale).save(out / "band-cal.png")
    icon(ICONS["gear"], pal["text2"]).save(out / "icon-gear.png")
    icon(ICONS["folder"], pal["text2"]).save(out / "icon-folder.png")
    print(f"assets written to {out} (engraving is {e.width / a.scale:.0f} px wide at {a.scale}×)")


if __name__ == "__main__":
    main()
