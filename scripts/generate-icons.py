"""Generate icons with python3 scripts/generate-icons.py (requires Pillow).

Shared SVG/PNG geometry stays within Android's central 80% safe circle.
Pillow is an asset-authoring dependency only; builds use the checked-in assets.
"""
from pathlib import Path
from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parent.parent / "public"
INK = "#292D23"
YELLOW = "#F1D653"
SEGMENTS = [(144, 176, 144, 336), (192, 200, 192, 312),
            (208, 256, 304, 256), (320, 200, 320, 312),
            (368, 176, 368, 336)]


def render(size, full_bleed=False):
    scale = 4
    canvas = Image.new("RGBA", (512 * scale, 512 * scale))
    draw = ImageDraw.Draw(canvas)
    if full_bleed:
        draw.rectangle((0, 0, 512 * scale, 512 * scale), fill=INK)
    else:
        draw.rounded_rectangle((0, 0, 512 * scale - 1, 512 * scale - 1),
                               radius=112 * scale, fill=INK)
    radius = 12 * scale
    for x1, y1, x2, y2 in SEGMENTS:
        draw.line((x1 * scale, y1 * scale, x2 * scale, y2 * scale),
                  fill=YELLOW, width=24 * scale)
        for x, y in [(x1 * scale, y1 * scale), (x2 * scale, y2 * scale)]:
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=YELLOW)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


path = " ".join(f"M{x1} {y1}L{x2} {y2}" for x1, y1, x2, y2 in SEGMENTS)
(PUBLIC / "icon.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
    f'<rect width="512" height="512" rx="112" fill="{INK}"/>'
    f'<path d="{path}" fill="none" stroke="{YELLOW}" stroke-width="24" '
    'stroke-linecap="round"/></svg>\n', encoding="utf-8")
for size in (192, 512):
    render(size).save(PUBLIC / f"icon-{size}.png", optimize=True)
render(180, full_bleed=True).convert("RGB").save(PUBLIC / "apple-touch-icon.png", optimize=True)
render(512, full_bleed=True).convert("RGB").save(PUBLIC / "icon-maskable-512.png", optimize=True)
render(256).save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print("Generated SVG, ICO, Apple touch, regular and maskable app icons.")
