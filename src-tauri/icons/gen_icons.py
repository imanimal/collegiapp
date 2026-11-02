#!/usr/bin/env python3
"""Generate the Collegiapp app icon: the front of the Pocket handheld.

A cream P9 body with a dark-bezel LCD showing the do-first list (a menu cursor on the top item, two dimmer items
below it), an orange key and a dark key printed with the app's own 9x9 "plus" and "focus" icons, and the speaker
slots from the label bands. Small sizes drop detail and snap edges to whole pixels so 16-48 px stay crisp.

Python stdlib only. Run from anywhere:

    python src-tauri/icons/gen_icons.py              # writes the icons next to this script
    python src-tauri/icons/gen_icons.py sheet.png    # also writes a preview sheet of every size

Writes next to this script:
    32x32.png, 128x128.png, 128x128@2x.png, icon.png (512), tray.png (32),
    icon.ico  (16/20/24/32/40/48/64 as 32-bit BMP entries + 256 as a PNG entry),
    icon.icns (PNG entries 16@2x to 512@2x, on the macOS grid: an 824/1024 body with room for its shadow).
And for the web app (ui/manifest.webmanifest, docs/SYNC.md), in ui/icons/:
    icon-192.png, icon-512.png (as above), apple-touch-icon.png (180, on the cream body colour, since iOS fills
    transparent corners with black and rounds the corners itself).

All PNGs are 8-bit RGBA (tauri-build requires RGBA).
"""

import math
import os
import struct
import sys
import zlib

OUT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(OUT, "..", "..", "ui", "icons")
WEB_BG = (0xE6, 0xE2, 0xD8)  # index.html's theme-color


def hexc(h):
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5))


# P9 Cream (ui/js/themes.js) plus the plastic shading pocket.css draws with gradients and shadows
BODY_TOP, BODY_BOT = hexc("#fbf9f4"), hexc("#ebe6da")
LIP_TOP, LIP_BOT = hexc("#d3ccbd"), hexc("#b4ab97")
CHROME, BLACK = hexc("#2a2722"), hexc("#0b0a09")
LCD_HI, LCD_BG, LCD_FG = hexc("#bfc9a6"), hexc("#b1bd93"), hexc("#1f2a17")
ACC_TOP, ACC, ACC_LIP = hexc("#ff8a55"), hexc("#ff5b1f"), hexc("#b83b0f")
KEY_TOP, KEY_LIP = hexc("#3b3731"), hexc("#0f0e0d")
SLOT = hexc("#c4bba8")
INK = hexc("#1b1915")
WHITE, SHADOW = (1.0, 1.0, 1.0), hexc("#281e0a")

# 9x9 pixel icons from ui/js/app.js
PLUS = ".........|....#....|....#....|....#....|.#######.|....#....|....#....|....#....|........."
FOCUS = "..#####..|.#.....#.|#..###..#|#.#...#.#|#.#.#.#.#|#.#...#.#|#..###..#|.#.....#.|..#####.."

# The LCD content on a 22x13 dot matrix (glass coordinates in cells): the cursor's rows, then bars as
# (col0, row0, col1, row1, ink). The top item is full ink; the ones ranked under it are dimmer.
CURSOR = [(1, 1, 2, 6), (2, 2, 3, 5), (3, 3, 4, 4)]
BARS = [(6, 2, 21, 5, 1.0), (1, 7, 3, 9, .5), (6, 7, 17, 9, .5), (1, 10, 3, 12, .5), (6, 10, 14, 12, .5)]
COLS, ROWS = 22, 13


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def clamp01(v):
    return 0.0 if v < 0 else 1.0 if v > 1 else v


class Canvas:
    """Premultiplied RGBA floats. Shapes paint through a coverage function over their bounding box only."""

    def __init__(self, n):
        self.n = n
        self.px = [[0.0, 0.0, 0.0, 0.0] for _ in range(n * n)]

    def paint(self, box, cover, color, alpha=1.0):
        n = self.n
        x0, y0 = max(0, int(math.floor(box[0])) - 1), max(0, int(math.floor(box[1])) - 1)
        x1, y1 = min(n, int(math.ceil(box[2])) + 1), min(n, int(math.ceil(box[3])) + 1)
        for y in range(y0, y1):
            py = y + 0.5
            for x in range(x0, x1):
                c = cover(x + 0.5, py) * alpha
                if c <= 0:
                    continue
                r, g, b = color(x + 0.5, py) if callable(color) else color
                p = self.px[y * n + x]
                k = 1.0 - c
                p[0], p[1], p[2], p[3] = r * c + p[0] * k, g * c + p[1] * k, b * c + p[2] * k, c + p[3] * k

    def rows(self):
        out = []
        for y in range(self.n):
            row = []
            for x in range(self.n):
                r, g, b, a = self.px[y * self.n + x]
                if a > 0:
                    r, g, b = r / a, g / a, b / a
                row.append(tuple(max(0, min(255, int(round(v * 255)))) for v in (r, g, b, a)))
            out.append(row)
        return out


def rbox(x0, y0, x1, y1, r):
    """Signed distance (px) to a rounded box."""
    cx, cy, hx, hy = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    r = max(0.0, min(r, hx, hy))

    def sd(px, py):
        qx, qy = abs(px - cx) - hx + r, abs(py - cy) - hy + r
        return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r
    return sd


def fill(sd):
    return lambda x, y: clamp01(0.5 - sd(x, y))


def rim(sd, sd_shift):
    """The sliver of one shape not covered by a shifted copy: a top highlight or an inner shadow edge."""
    return lambda x, y: clamp01(0.5 - sd(x, y)) * clamp01(0.5 + sd_shift(x, y))


def vgrad(top, bot, y0, y1):
    return lambda x, y: mix(top, bot, clamp01((y - y0) / max(1e-6, y1 - y0)))


def render(n, grid="win", tray=False):
    """One icon of n x n px. grid "win" fills the canvas; "mac" uses the macOS 824/1024 body."""
    lvl = 2 if n >= 96 else 1 if n >= 40 else 0      # detail: full, mid, small
    snap = n < 64
    if tray or lvl == 0:
        pad_x, pad_t, pad_b = 0.0, 0.0, 0.0
    elif grid == "mac":
        pad_x, pad_t, pad_b = 0.098, 0.085, 0.111
    else:
        pad_x, pad_t, pad_b = 0.035, 0.025, 0.045
    T = n * (1 - 2 * pad_x)                            # body width in px
    ox, oy = n * pad_x, n * pad_t
    sy = (n * (1 - pad_t - pad_b)) / T                 # body is slightly taller than wide when padded

    def S(v):
        return float(round(v)) if snap else v

    def X(u):
        return S(ox + u * T)

    def Y(v):
        return S(oy + v * T * sy)

    def L(u, least=1.0):                               # a length that never vanishes at small sizes
        v = u * T
        return max(least, float(round(v))) if snap else v

    c = Canvas(n)
    bx0, bx1, by0, by1 = X(0), X(1), Y(0), Y(1)
    lip = L(0.032)
    body_r = 0.2 * T

    # soft shadow under the body
    if lvl >= 1:
        sh = rbox(bx0 + 0.02 * T, by0 + 0.05 * T, bx1 - 0.02 * T, by1 + 0.015 * T, body_r)
        spread = 0.045 * T
        c.paint((bx0 - spread, by0, bx1 + spread, by1 + spread * 1.6),
                lambda x, y: 0.3 * clamp01(1 - max(0.0, sh(x, y)) / spread) ** 2, SHADOW)

    # body: the plastic lip, then the face above it with a highlight along its top edge
    lip_sd = rbox(bx0, by0 + lip, bx1, by1, body_r)
    face = rbox(bx0, by0, bx1, by1 - lip, body_r)
    c.paint((bx0, by0, bx1, by1), fill(lip_sd), vgrad(LIP_TOP, LIP_BOT, by1 - 3 * lip, by1))
    c.paint((bx0, by0, bx1, by1), fill(face), vgrad(BODY_TOP, BODY_BOT, by0, by1))
    if lvl >= 1:
        c.paint((bx0, by0, bx1, by1), rim(face, rbox(bx0, by0 + L(0.012), bx1, by1 - lip, body_r)), WHITE, 0.9)

    # LCD: chrome bezel (black outline at full detail), glass, inner shadow, dot matrix, reflection
    zx0, zy0, zx1, zy1 = X(0.1), Y(0.09), X(0.9), Y(0.6)
    if lvl == 2:
        c.paint((zx0, zy0, zx1, zy1), fill(rbox(zx0 - 1, zy0 - 1, zx1 + 1, zy1 + 1, 0.08 * T + 1)), BLACK)
    c.paint((zx0, zy0, zx1, zy1), fill(rbox(zx0, zy0, zx1, zy1, 0.08 * T)), CHROME)
    inset = L(0.045)
    gx0, gy0, gx1, gy1 = zx0 + inset, zy0 + inset, zx1 - inset, zy1 - inset
    glass = rbox(gx0, gy0, gx1, gy1, 0.035 * T if lvl else 0.5)
    # 170deg: the light corner is top-left, full LCD green from 60% of the way down
    c.paint((gx0, gy0, gx1, gy1), fill(glass),
            lambda x, y: mix(LCD_HI, LCD_BG, clamp01(((y - gy0) / (gy1 - gy0) + 0.17 * (x - gx0) / (gx1 - gx0)) / 0.6)))
    if lvl >= 1:
        # inset shadow along the top edge, as the bezel overhangs the glass
        depth = 0.05 * T
        c.paint((gx0, gy0, gx1, gy0 + depth),
                lambda x, y: clamp01(0.5 - glass(x, y)) * 0.3 * (1 - clamp01((y - gy0) / depth)) ** 1.5, (0, 0, 0))

    cw, ch = (gx1 - gx0) / COLS, (gy1 - gy0) / ROWS
    if lvl == 2:
        # dot matrix: every cell is a square with a gap; unlit cells show faintly, as on a real LCD
        dot = 0.84
        lit = {}
        for (c0, r0, c1, r1, ink) in BARS:
            for i in range(c0, c1):
                for j in range(r0, r1):
                    lit[(i, j)] = ink
        for (c0, r0, c1, r1) in CURSOR:
            for i in range(c0, c1):
                for j in range(r0, r1):
                    lit[(i, j)] = 1.0
        for i in range(COLS):
            for j in range(ROWS):
                x0 = gx0 + (i + (1 - dot) / 2) * cw
                y0 = gy0 + (j + (1 - dot) / 2) * ch
                cell = rbox(x0, y0, x0 + cw * dot, y0 + ch * dot, cw * 0.12)
                c.paint((x0, y0, x0 + cw, y0 + ch), fill(cell), LCD_FG, 0.88 * lit.get((i, j), 0.06))
    else:
        # solid shapes snapped to pixels; the small sizes keep the cursor (from 24 px) and the top two items
        def cell_box(c0, r0, c1, r1):
            return S(gx0 + c0 * cw), S(gy0 + r0 * ch), S(gx0 + c1 * cw), S(gy0 + r1 * ch)

        if n < 24:
            # 16 and 20 px are laid out in whole pixels: a 1 px margin, the top item 2 px tall, the rest 1 px
            gw, gh = int(gx1 - gx0), int(gy1 - gy0)
            rects = [(1, 1, gw - 1, 3, 1.0), (1, 4, 1 + round((gw - 2) * 0.7), 5, .6)]
            if gh >= 8:
                rects.append((1, 6, 1 + round((gw - 2) * 0.5), 7, .6))
            for (x0, y0, x1, y1, ink) in rects:
                x0, y0, x1, y1 = gx0 + x0, gy0 + y0, gx0 + x1, gy0 + y1
                c.paint((x0, y0, x1, y1), fill(rbox(x0, y0, x1, y1, 0)), LCD_FG, 0.9 * ink)
        bars = BARS if n >= 32 else [b for b in BARS if b[0] == 6] if n >= 24 else []
        for (c0, r0, c1, r1, ink) in bars:
            x0, y0, x1, y1 = cell_box(c0, r0, c1, r1)
            if y1 - y0 < 1:
                y1 = y0 + 1
            c.paint((x0, y0, x1, y1), fill(rbox(x0, y0, x1, y1, 0)), LCD_FG, 0.9 * ink)
        if n >= 24:
            for (c0, r0, c1, r1) in CURSOR:
                x0, y0, x1, y1 = cell_box(c0, r0, c1, r1)
                if x1 - x0 < 1:
                    x1 = x0 + 1
                if y1 - y0 < 1:
                    y1 = y0 + 1
                c.paint((x0, y0, x1, y1), fill(rbox(x0, y0, x1, y1, 0)), LCD_FG, 0.9)
    if lvl >= 1:
        # the reflective glass: a soft diagonal sheen across the upper left
        k = (gx1 - gx0) * 0.42
        c.paint((gx0, gy0, gx1, gy1),
                lambda x, y: clamp01(0.5 - glass(x, y)) * clamp01(0.5 - ((x - gx0) + (y - gy0) * 1.6 - k)) * 0.16, WHITE)

    # keys: an orange "add" key and a dark "focus" key, each with a darker lip below its face
    ky0, ky1 = Y(0.665), Y(0.835)
    klip = L(0.032)

    def key(x0, x1, top, bot, lipc, glyph, ink):
        r = 0.055 * T if lvl else 1.0
        c.paint((x0, ky0, x1, ky1 + klip), fill(rbox(x0, ky0 + klip, x1, ky1 + klip, r)), lipc)
        kf = rbox(x0, ky0, x1, ky1, r)
        c.paint((x0, ky0, x1, ky1), fill(kf), vgrad(top, bot, ky0, ky1))
        if lvl >= 1:
            c.paint((x0, ky0, x1, ky1), rim(kf, rbox(x0, ky0 + L(0.012), x1, ky1, r)), WHITE, 0.35)
        if lvl == 2 and glyph:
            p = max(1.0, float(round(0.0115 * T)))
            gx = round((x0 + x1) / 2 - 4.5 * p)
            gy = round((ky0 + ky1) / 2 - 4.5 * p)
            for j, row in enumerate(glyph.split("|")):
                for i, ch_ in enumerate(row):
                    if ch_ == "#":
                        x, y = gx + i * p, gy + j * p
                        c.paint((x, y, x + p, y + p), fill(rbox(x, y, x + p, y + p, 0)), ink)

    key(X(0.1), X(0.53), ACC_TOP, ACC, ACC_LIP, PLUS, INK)
    key(X(0.58), X(0.75), KEY_TOP, CHROME, KEY_LIP, FOCUS, ACC)

    # speaker slots: the |||| that ends every label band in the app
    if lvl >= 1:
        sw = L(0.024)
        for u in (0.8, 0.845, 0.89):
            x0 = X(u - 0.012)
            slot = rbox(x0, Y(0.675), x0 + sw, Y(0.86), sw / 2)
            c.paint((x0, Y(0.675), x0 + sw, Y(0.86)), fill(slot), SLOT)
            c.paint((x0, Y(0.675), x0 + sw, Y(0.86)), rim(slot, rbox(x0, Y(0.675) + L(0.01), x0 + sw, Y(0.86), sw / 2)),
                    (0, 0, 0), 0.25)
    return c.rows()


def png_bytes(rows):
    h = len(rows)
    w = len(rows[0])
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter: none
        for (r, g, b, a) in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def bmp_dib_bytes(rows):
    """32-bit BGRA DIB (BITMAPINFOHEADER + XOR bitmap + AND mask) for ICO entries."""
    h = len(rows)
    w = len(rows[0])
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    xor = bytearray()
    for row in reversed(rows):  # bottom-up
        for (r, g, b, a) in row:
            xor += bytes((b, g, r, a))
    mask_row_bytes = ((w + 31) // 32) * 4
    and_mask = bytes(mask_row_bytes * h)  # all zero: alpha channel decides
    return header + bytes(xor) + and_mask


def write_ico(path, entries):
    """entries: list of (size, data_bytes)."""
    out = bytearray(struct.pack("<HHH", 0, 1, len(entries)))
    offset = 6 + 16 * len(entries)
    blobs = []
    for size, data in entries:
        dim = 0 if size >= 256 else size
        out += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        blobs.append(data)
    for b in blobs:
        out += b
    with open(path, "wb") as f:
        f.write(out)


def write_icns(path, entries):
    """entries: list of (ostype bytes, png bytes)."""
    body = bytearray()
    for ostype, data in entries:
        body += ostype + struct.pack(">I", len(data) + 8) + data
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + bytes(body))


def sheet(path, imgs):
    """Preview: every size on light and dark, then the small ones enlarged 8x (nearest neighbour)."""
    big = [(r, 8) for r in imgs if len(r) <= 32]
    items = [(r, 1) for r in imgs] + big
    gap = 16
    w = sum(len(r) * z for r, z in items) + gap * (len(items) + 1)
    hh = max(len(r) * z for r, z in items) + 2 * gap
    rows = []
    for band, bg in ((0, (243, 241, 236)), (1, (32, 32, 32))):
        canvas = [[bg + (255,) for _ in range(w)] for _ in range(hh)]
        x = gap
        for r, z in items:
            n = len(r)
            y0 = hh - gap - n * z
            for yy in range(n * z):
                for xx in range(n * z):
                    pr, pg, pb, pa = r[yy // z][xx // z]
                    a = pa / 255.0
                    o = canvas[y0 + yy][x + xx]
                    canvas[y0 + yy][x + xx] = (int(pr * a + o[0] * (1 - a)), int(pg * a + o[1] * (1 - a)),
                                               int(pb * a + o[2] * (1 - a)), 255)
            x += n * z + gap
        rows += canvas
    with open(path, "wb") as f:
        f.write(png_bytes(rows))


def main():
    cache = {}

    def img(size, grid="win"):
        if (size, grid) not in cache:
            cache[(size, grid)] = render(size, grid)
        return cache[(size, grid)]

    def save_png(name, rows):
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(png_bytes(rows))

    save_png("32x32.png", img(32))
    save_png("128x128.png", img(128))
    save_png("128x128@2x.png", img(256))
    save_png("icon.png", img(512))
    save_png("tray.png", render(32, tray=True))

    small = (16, 20, 24, 32, 40, 48, 64)
    ico_entries = [(s, bmp_dib_bytes(img(s))) for s in small]
    ico_entries.append((256, png_bytes(img(256))))
    write_ico(os.path.join(OUT, "icon.ico"), ico_entries)

    write_icns(os.path.join(OUT, "icon.icns"), [
        (b"ic11", png_bytes(img(32, "mac"))),
        (b"ic12", png_bytes(img(64, "mac"))),
        (b"ic07", png_bytes(img(128, "mac"))),
        (b"ic13", png_bytes(img(256, "mac"))),
        (b"ic08", png_bytes(img(256, "mac"))),
        (b"ic14", png_bytes(img(512, "mac"))),
        (b"ic09", png_bytes(img(512, "mac"))),
        (b"ic10", png_bytes(img(1024, "mac"))),
    ])
    os.makedirs(WEB, exist_ok=True)

    def save_web(name, rows):
        with open(os.path.join(WEB, name), "wb") as f:
            f.write(png_bytes(rows))

    def flat(rows, bg):
        return [[tuple(round(c * a / 255 + k * (255 - a) / 255) for c, k in zip(px[:3], bg)) + (255,) for px in row
                 for a in (px[3],)] for row in rows]

    save_web("icon-192.png", img(192))
    save_web("icon-512.png", img(512))
    save_web("apple-touch-icon.png", flat(render(180, "mac"), WEB_BG))
    print("icons written to", OUT, "and", os.path.normpath(WEB))
    if len(sys.argv) > 1:
        sheet(sys.argv[1], [img(s) for s in small] + [img(128), img(256), img(256, "mac")])
        print("preview sheet:", sys.argv[1])


if __name__ == "__main__":
    main()
