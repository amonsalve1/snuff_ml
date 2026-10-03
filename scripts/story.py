"""The README's pictures: the banner, one winner's season in five banners,
then four diagrams of how the model works.

Every picture is the same frame, taken from the site (docs/_mock/c.html): a
strip of pixel sky, sea and sand on top (scripts/beach.py, the light from
stage.js), an italic Fraunces headline with one rust word, a DM Mono kicker,
and one thing to look at underneath, drawn in art pixels on paper. The story
banners get later in the day as you scroll, midday at "this is rachel." to
night at the last one, and each takes its paper and colours from its own
light. The diagrams after it run through
the next day, morning to night.

Everything is drawn from the backtest, so it regenerates with the data instead
of drifting. The castaways are the site's own pixel art, read out of docs/js,
and the type is the site's own fonts, subset and embedded.

Long sentences live in the README, not in the pictures. This script writes
them into README.md between the story markers, from the same data as the
pictures. Text inside a picture never goes below MIN_TEXT.

The cast is derived, not typed in: the winner and the model's favorite at
episode 4. Every claim about them is asserted first, so if a rerun of the
study changes the story, this fails instead of publishing something false.
The winner is drawn as a single-colour silhouette, never as a likeness.

Reads reports/retrospective/preds_blend.parquet, data/interim/edgic.parquet
and the feature panel, writes docs/story/*.svg and the README block. Run
after `snuffml study --loso`:

    uv run python scripts/story.py
"""

from __future__ import annotations

import base64
import functools
import html
import json
import io
import math
import re
import textwrap

import beach
import numpy as np
import pandas as pd
from fontTools import subset as ft_subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image

from snuffml import config
from snuffml.features import build as build_mod

SEASON = 47

DOCS = config.PROJECT_ROOT / "docs"
OUT = DOCS / "story"
JS = DOCS / "js"
README = config.PROJECT_ROOT / "README.md"
START, END = "<!-- story:start -->", "<!-- story:end -->"
LIVE_START, LIVE_END = "<!-- live:start -->", "<!-- live:end -->"
SITE = "https://amonsalve1.github.io/snuff_ml/"

W = 1000  # every picture, so they stack at one scale
PX = beach.S  # one art pixel, same as the site
C = W // PX  # art columns
MIN_TEXT = 16  # nothing inside a picture is set smaller than this
TX = 70  # left edge of the headline, kicker and row labels

# the mock's tokens
BG = "#f5efe3"  # paper
INK = "#1d1a16"
MUTED = "#5f584c"
FAINT = "#6f685b"
LINE = "#ddd3c0"
FIELD = "#fffaf0"
FLAME = "#c2410c"
SEA = "#24516b"
ON_FLAME = "#fff6ea"
NAVY = "#13203a"  # the mock's day ink
ACCENT = "#a33a08"  # the mock's day accent


# ---------------------------------------------------------------- light
# each picture's colours come from its own hour: the paper from that hour's
# sand, Rachel's colour from what glows then (rust by day, the sun path at
# dusk, firelight at night), the ink from the sky. p is the stage.js light.

THEMES = {
    "day": dict(p=0.12, paper=BG, ink=NAVY, hero=FLAME, accent=ACCENT, muted=MUTED,
                faint=FAINT, line=LINE, tan="#c9ab7f", shadow="#ffffff"),
    "afternoon": dict(p=0.36, paper="#f3ead7", ink=NAVY, hero=FLAME, accent=ACCENT,
                      muted=MUTED, faint=FAINT, line=LINE, tan="#c9ab7f", shadow="#ffffff"),
    "golden": dict(p=0.6, paper="#f1dfc2", ink="#2e2338", hero="#b33c0c", accent="#963006",
                   muted="#6c5640", faint="#86694c", line="#e0c59c", tan="#c9a06f",
                   shadow="#ffffff"),
    "late": dict(p=0.46, paper="#f2e3c9", ink="#22243c", hero="#b93e0c", accent="#9c3307",
                 muted="#665a48", faint="#7c6c55", line="#e3cfae", tan="#c6a473",
                 shadow="#ffffff"),
    "dusk": dict(p=0.83, paper="#3a2e41", ink="#f7e4d4", hero="#f2a06b", accent="#ffb788",
                 muted="#d0b2bf", faint="#a98d9f", line="#57455c", tan="#8f6f7c",
                 shadow="#000000"),
    "night": dict(p=0.99, paper="#111832", ink="#efe8d6", hero="#ffb547", accent="#ffc46b",
                  muted="#a9b0cc", faint="#8a92b2", line="#28304f", tan="#5d6b9c",
                  shadow="#000000", mark="#efe4c0"),
    "morning": dict(p=0.0, paper=BG, ink=NAVY, hero=FLAME, accent=ACCENT, muted=MUTED,
                    faint=FAINT, line=LINE, tan="#c9ab7f", shadow="#ffffff"),
}
for _t in THEMES.values():
    _t.setdefault("mark", _t["ink"])
    _t["dark"] = _t["shadow"] == "#000000"


# ---------------------------------------------------------------- type

STACK = {
    "headline": "sf-headline,Fraunces,'Iowan Old Style',Georgia,serif",
    "sans": "sf-sans,'Nunito Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif",
    "mono": "sf-mono,'DM Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace",
}

# the site's own font files, each pinned to the one instance its role uses.
# fraunces keeps its default wonk; the headline cut is the large optical size.
FACES = {
    ("headline", 400): ("fraunces.woff2", {"wght": 400, "opsz": 72, "SOFT": 0, "WONK": 1}),
    ("headline", 600): ("fraunces.woff2", {"wght": 600, "opsz": 72, "SOFT": 0, "WONK": 1}),
    ("sans", 400): ("nunito-sans.woff2", {"wght": 400}),
    ("sans", 700): ("nunito-sans.woff2", {"wght": 700}),
    ("mono", 500): ("dm-mono-500.woff2", None),
}

# characters each face draws in the picture being built, so each picture
# embeds only the glyphs it uses
USED: dict[tuple[str, int], set[str]] = {}


def face(family: str, weight: int) -> tuple[str, int]:
    if family == "mono":
        return ("mono", 500)
    return (family, (700 if family == "sans" else 600) if weight >= 600 else 400)


@functools.cache
def _static(key: tuple[str, int]) -> bytes:
    file, axes = FACES[key]
    font = TTFont(DOCS / "fonts" / file)
    if axes:
        font = instancer.instantiateVariableFont(font, axes)
    font.recalcTimestamp = False  # same bytes every run, so reruns don't churn the svgs
    buf = io.BytesIO()
    font.flavor = None
    font.save(buf)
    return buf.getvalue()


def _woff2(key: tuple[str, int], chars: str) -> str:
    font = TTFont(io.BytesIO(_static(key)))
    opts = ft_subset.Options()
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]  # keep the licence in the font
    sub = ft_subset.Subsetter(opts)
    sub.populate(text=chars)
    sub.subset(font)
    font.flavor = "woff2"
    font.recalcTimestamp = False
    buf = io.BytesIO()
    font.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


def fontfaces() -> str:
    rules = [
        f'@font-face{{font-family:"sf-{fam}";font-weight:{wt};'
        f'src:url(data:font/woff2;base64,{_woff2((fam, wt), "".join(sorted(chars | {" "})))}) '
        f'format("woff2")}}'
        for (fam, wt), chars in sorted(USED.items())
    ]
    note = ("/* fraunces, nunito sans and dm mono from docs/fonts, subset to the glyphs "
            "this picture uses. SIL Open Font License 1.1 */")
    return f"<style>{note}{''.join(rules)}</style>"


def t(x, y, s, *, size=MIN_TEXT, fill=INK, weight=400, family="sans", anchor="start", extra=""):
    s = str(s)
    assert size >= MIN_TEXT, f"{size} is under the {MIN_TEXT}-unit floor: {s!r}"
    key = face(family, weight)
    USED.setdefault(key, set()).update(s)
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" font-family="{STACK[family]}" font-size="{size}" '
        f'font-weight="{key[1]}" fill="{fill}" text-anchor="{anchor}"{extra}>'
        f"{html.escape(s)}</text>"
    )


def kicker(x, y, s, *, fill, anchor="start") -> str:
    """The mock's kicker: DM Mono, uppercase, tracked out."""
    return t(x, y, s.upper(), fill=fill, family="mono", anchor=anchor,
             extra=' letter-spacing="2.6"')


def mono_width(s: str, size: float = MIN_TEXT) -> float:
    return len(s) * 0.6 * size  # dm mono advances 0.6 em


def headline(o, x, y, parts, T, *, size=52, anchor="start"):
    """parts: (text, style), "" plain, "a" the one rust word, "b" bold ink. An
    offset copy underneath, white by day and black by night, lifts it off the
    sky."""
    weight = {"": 400, "a": 600, "b": 600}
    for s, sty in parts:
        USED.setdefault(("headline", weight[sty]), set()).update(s)
    for dy, shadow in ((2.5, True), (0, False)):
        spans = "".join(
            f'<tspan font-weight="{weight[sty]}" '
            f'fill="{T["shadow"] if shadow else T["accent"] if sty == "a" else T["ink"]}">'
            f"{html.escape(s)}</tspan>" for s, sty in parts)
        o.append(f'<text x="{x}" y="{y + dy}" font-family="{STACK["headline"]}" '
                 f'font-size="{size}" font-style="italic" opacity="{0.45 if shadow else 1}" '
                 f'text-anchor="{anchor}" letter-spacing="-1">{spans}</text>')


def title(x, y, s, T, *, size=24, fill=None, anchor="start") -> str:
    """A small italic headline, for row names and diagram labels."""
    return t(x, y, s, size=size, family="headline", weight=600, fill=fill or T["ink"],
             anchor=anchor, extra=' font-style="italic"')


# ---------------------------------------------------------------- pixel art


def _block(src: str, name: str) -> str:
    """The body of `const NAME = { ... }`, brace matched."""
    start = src.index(f"{name} = {{") + len(name) + 3
    depth = 0
    for j in range(start, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[start : j + 1]
    raise ValueError(f"unterminated {name}")


def _pairs(body: str) -> dict[str, str]:
    # keys are bare in jungle-sprites.js and quoted in camp.js
    return dict(re.findall(r"'?(.)'?:\s*'(#[0-9a-fA-F]{6})'", body))


def _grids(src: str) -> dict[str, list[str]]:
    grids = {}
    for m in re.finditer(r"(\w+): \[\n(.*?)\n\s*\]", src, re.S):
        rows = re.findall(r"'([^']*)'", m.group(2))
        if rows and len({len(r) for r in rows}) == 1:
            grids[m.group(1)] = rows
    return grids


JUNGLE = (JS / "jungle-sprites.js").read_text()
CAMP = (JS / "camp.js").read_text()
WILD = (JS / "wildlife.js").read_text()
PAL = {
    **_pairs(_block(JUNGLE, "PALETTE")),
    **_pairs(_block(WILD, "EXTRA_PALETTE")),
    **_pairs(_block(CAMP, "CAMP_PALETTE_EXTRA")),
}
GRIDS = {**_grids(JUNGLE), **_grids(WILD), **_grids(CAMP)}
LOOKS = [
    re.findall(r"'(.)'", line)
    for line in re.search(r"const LOOKS = \[(.*?)\];", CAMP, re.S).group(1).strip().splitlines()
]

# camp art is drawn with marker letters and recoloured per look:
# skin, skin shadow, hair, hair fall, shorts, shorts shadow
MARKERS = "uUNlCB"
POSES = ("IDLE_A", "IDLE_B", "TALK_A", "TALK_B", "SIT_A")

for _need in (*POSES, "PALM", "PALM_TALL", "TORCH_LIT_A", "GRASS", "CRAB_A", "CRAB_B",
              "FERN_SMALL", "ROCK_SMALL", "LIZARD_A", "COCONUTS", "DRIFTWOOD", "GULL_A"):
    _missing = set("".join(GRIDS[_need])) - set(PAL) - set(MARKERS) - {"."}
    assert not _missing, f"{_need} uses colours with no palette entry: {_missing}"


def woman(grid: list[str]) -> list[str]:
    """The site's castaway art is one shirtless body. Derive a woman from it:
    hair down the back in the look's own hair colour, and a swimsuit top in the
    shorts colour so the outfit matches. Works on any pose because it finds the
    chest from where the shorts start."""
    rows = [list(r) for r in grid]
    shorts = next(i for i, r in enumerate(rows) if "C" in r)
    eye = next(i for i, r in enumerate(rows) if "o" in r)
    chest = (shorts - 4, shorts - 3)
    for i in chest:
        for c in range(3, 8):
            if rows[i][c] == "u":
                rows[i][c] = "C"
            elif rows[i][c] == "U":
                rows[i][c] = "B"
    back = min(c for c, ch in enumerate(rows[eye]) if ch != ".")
    for i in range(eye, chest[1] + 1):
        if rows[i][back] in ".ul":
            rows[i][back] = "N"
        if i <= eye + 2 and back + 1 < len(rows[i]) and rows[i][back + 1] == "l":
            rows[i][back + 1] = "N"
    return ["".join(r) for r in rows]


def tee(grid: list[str]) -> list[str]:
    """A third body for anyone who isn't a man or a woman: a tee over the whole
    torso, nothing else changed."""
    rows = [list(r) for r in grid]
    shorts = next(i for i, r in enumerate(rows) if "C" in r)
    for i in range(shorts - 5, shorts):
        for c in range(3, 8):
            if rows[i][c] in "uU":
                rows[i][c] = "C" if rows[i][c] == "u" else "B"
    return ["".join(r) for r in rows]


def body(pose: str, kind: str) -> list[str]:
    return {"f": woman, "n": tee}.get(kind, lambda g: g)(GRIDS[pose])


def castaway(pose: str, look: int, kind: str = "m") -> list[str]:
    swap = str.maketrans({m: LOOKS[look][i] for i, m in enumerate(MARKERS)})
    return [r.translate(swap) for r in body(pose, kind)]


class Art:
    """The picture at art resolution, prefilled with the theme's paper."""

    def __init__(self, h: int, T: dict):
        self.rows = h // PX
        self.buf = np.tile(beach.rgb(T["paper"]), (self.rows, C, 1)).astype(float)

    def put(self, x, y, c, al=1.0):
        x, y = int(x), int(y)
        if 0 <= x < C and 0 <= y < self.rows:
            self.buf[y, x] = self.buf[y, x] * (1 - al) + np.asarray(c, float) * al

    def image(self) -> Image.Image:
        return Image.fromarray(np.clip(self.buf, 0, 255).astype("uint8"), "RGB")


def horizon(art, L, *, sky, sea, sand, fade_bot, sea_x):
    """The site's horizon, compressed to a band from the top edge: dithered
    sky, sea with the sun path, a lip of foam, sand dithered into paper."""
    for y in range(sky):
        t_ = y / max(1, sky - 1)
        for x in range(C):
            art.buf[y, x] = beach.band(L["sky"][3:], t_, x, y)
    y0 = sky
    for y in range(y0, y0 + sea):
        t_ = (y - y0) / max(1, sea - 1)
        for x in range(C):
            art.buf[y, x] = beach.band(L["sea"], t_, x, y)
            if beach.hsh(x * 7, y) > 0.93:
                art.buf[y, x] = L["glint"]
            if abs(x - C * sea_x) < 2 + (y - y0) * 3 and beach.hsh(x, y) > 0.5:
                art.buf[y, x] = beach.mix(art.buf[y, x], L["path"], 0.8)
    y0 += sea
    for x in range(C):
        art.buf[y0, x] = L["foamEdge"] if beach.dith(x, y0, 0.7) else L["foam"]
    y0 += 1
    for y in range(y0, y0 + sand):
        t_ = (y - y0) / max(1, sand - 1)
        keep = (y0 + sand - y) / fade_bot if y0 + sand - y <= fade_bot else 1
        for x in range(C):
            if beach.dith(x, y, keep):
                c = beach.band(L["sand"][:4], t_, x, y)
                if beach.hsh(x, y) > 0.98:
                    c = beach.mix(c, beach.rgb("#ffffff"), 0.15)
                art.buf[y, x] = c
    return y0 + sand


def night_sky(art, L):
    """Stars, and a pixel moon top right, when the light is dark enough."""
    if L["stars"] <= 0.3:
        return
    for y in range(24):
        for x in range(C):
            if beach.hsh(x * 13, y * 7) > 0.985 - 0.004 * (y < 12):
                art.put(x, y, L["glint"], L["stars"] * (1 - y / 30))
    mx, my, mr = C - 30, 9, 4.5
    moon, crater = beach.rgb("#f4ecd2"), beach.rgb("#e2d6b4")
    for y in range(my - 9, my + 10):
        for x in range(mx - 9, mx + 10):
            d = math.hypot(x - mx, y - my)
            if d <= mr:
                spot = (x - mx, y - my) in ((-1, -1), (2, 1), (-2, 2))
                art.put(x, y, crater if spot else moon)
            elif d < 9 and beach.dith(x, y, (1 - d / 9) * 0.5):
                art.put(x, y, moon, 0.18)


def stage(h, T, *, sky=28, sand=None, sea_x=0.86):
    """The frame every picture shares: a band of sky, sea and sand, then
    paper. Returns the art and the y, in screen units, where paper starts."""
    art = Art(h, T)
    L = beach.light_at(T["p"])
    sand = sand if sand is not None else (3 if T["dark"] else 6)
    end = horizon(art, L, sky=sky, sea=3, sand=sand, fade_bot=sand, sea_x=sea_x)
    night_sky(art, L)
    return art, end * PX


def block(art, x0, y0, w, h, col, *, shade=0.18):
    """A pixel tile: flat fill, lit top row, shaded bottom row and right edge."""
    col = np.asarray(col, float)
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            c = col
            if y == y0:
                c = beach.mix(col, beach.rgb("#ffffff"), shade)
            elif y == y0 + h - 1 or x == x0 + w - 1:
                c = beach.mix(col, beach.rgb("#000000"), shade)
            art.put(x, y, c)


def person(art, x, base, grid, *, colour=None, flip=False):
    """A castaway standing on row `base`, with a soft shadow at their feet."""
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch != ".":
                art.put(x + (len(row) - 1 - c if flip else c), base - len(grid) + r,
                        colour if colour is not None else beach.rgb(PAL[ch]))
    for k in range(1, 5):
        art.put(x + 3 + k, base, [40, 30, 30], 0.22)


def ring(art, cx, cy, r, colour, *, squash=1.05):
    """A hand-pulled pixel ring."""
    for a in range(0, 360, 2):
        rr = r + math.sin(math.radians(a * 3)) * 0.6
        x = round(cx + rr * math.cos(math.radians(a)))
        y = round(cy + rr * squash * math.sin(math.radians(a)))
        art.put(x, y, colour)
        if a % 4 == 0:
            art.put(x + 1, y, colour, 0.6)


def speech(art, x, y, w, h, dots, *, tail=1):
    """A pixel speech bubble, top left at (x, y), tail down-left (1) or
    down-right (-1)."""
    edge, fill, ink = beach.rgb("#3b4a66"), beach.rgb(FIELD), beach.rgb(NAVY)
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if yy in (y, y + h - 1) and xx in (x, x + w - 1):
                continue
            art.put(xx, yy, edge if yy in (y, y + h - 1) or xx in (x, x + w - 1) else fill)
    tx = x + 2 if tail == 1 else x + w - 3
    art.put(tx, y + h, edge)
    art.put(tx - tail, y + h + 1, edge)
    gap = (w - 2) / (dots + 1)
    for d in range(dots):
        art.put(round(x + 1 + gap * (d + 1)), y + h // 2, ink)


NECKLACE = [
    "b.........b",
    "b.........b",
    ".b.......b.",
    ".b.......b.",
    "..b.....b..",
    "...bb.bb...",
    ".....F.....",
    "....FyF....",
    "...FycyF...",
    "....FyF....",
    ".....F.....",
]


def stamp(art, x, y, grid):
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch != ".":
                art.put(x + c, y + r, beach.rgb(PAL[ch]))


def sand_patch(art, cx, base, w, L):
    """A little dithered island of sand for a vignette to stand on."""
    for y in range(base - 2, base + 3):
        for x in range(cx - w, cx + w + 1):
            d = ((x - cx) / w) ** 2 + ((y - base) / 2.6) ** 2
            if d <= 1 and beach.dith(x, y, min(1, (1 - d) * 2.2)):
                art.put(x, y, beach.band(L["sand"][:4], (y - base + 2) / 4, x, y))


def png_data(img: Image.Image) -> str:
    """Pixel art scaled by PX with nearest neighbour, as a small png data uri."""
    big = img.resize((img.width * PX, img.height * PX), Image.NEAREST)
    big = big.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    buf = io.BytesIO()
    big.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def svg_open(h: int, name: str) -> list[str]:
    USED.clear()
    return [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {h}" width="{W}" '
            f'height="{h}" role="img">', f"<title>{html.escape(name)}</title>",
            f'<defs><clipPath id="f"><rect width="{W}" height="{h}" rx="6"/></clipPath></defs>']


def finish(name: str, o: list[str], art: Art, h: int, T: dict) -> None:
    o.insert(3, f'<image href="{png_data(art.image())}" width="{W}" height="{h}" '
                'clip-path="url(#f)" style="image-rendering:pixelated"/>')
    o.append(f'<rect x="0.5" y="0.5" width="{W - 1}" height="{h - 1}" rx="6" fill="none" '
             f'stroke="{T["line"]}"/>')
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text("\n".join([o[0], fontfaces(), *o[1:], "</svg>"]) + "\n")
    print(f"wrote docs/story/{name}  ({(OUT / name).stat().st_size // 1024} KB)")


def ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def mix(a: str, b: str, k: float) -> str:
    """k of colour a over colour b."""
    pa = [int(a[i : i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i : i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x * k + y * (1 - k)):02x}" for x, y in zip(pa, pb))


def luminance(c: str) -> float:
    r, g, b = (int(c[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


# ---------------------------------------------------------------- the data


PREDS = pd.read_parquet(config.REPORTS_DIR / "retrospective" / "preds_blend.parquet")
EDGIC = pd.read_parquet(config.INTERIM_DIR / "edgic.parquet")
EDGIC = EDGIC[EDGIC["contemporaneous"]]
G = PREDS[PREDS["season"] == SEASON]
LAST_EP = int(G["episode"].max())
ALIVE = G.groupby("episode").size()
N_SEASONS = PREDS["season"].nunique()


def at(ep: int, g: pd.DataFrame = G) -> pd.DataFrame:
    return g[g["episode"] == ep].sort_values("win_prob", ascending=False).reset_index(drop=True)


def rank(who: str, ep: int) -> int | None:
    s = at(ep)
    hit = s.index[s["castaway"] == who]
    return int(hit[0]) + 1 if len(hit) else None


def player(who: str) -> pd.DataFrame:
    return G[G["castaway"] == who].sort_values("episode").set_index("episode")


def rating(who: str, ep: int) -> tuple[str, str | None, float | None] | None:
    r = EDGIC[(EDGIC["season"] == SEASON) & (EDGIC["castaway"] == who) & (EDGIC["episode"] == ep)]
    if r.empty:
        return None
    row = r.iloc[0]
    tone = None if pd.isna(row["tone"]) else str(row["tone"])
    vis = None if pd.isna(row["visibility"]) else float(row["visibility"])
    return str(row["rating"]), tone, vis


def gender(who: str) -> str:
    first = G[G["episode"] == 1].set_index("castaway")
    return {"female": "f", "non-binary": "n"}.get(str(first.loc[who, "gender"]).lower(), "m")


WINNER = G.loc[G["is_winner"], "castaway"].iloc[0]
FAVORITE = at(4)["castaway"].iloc[0]  # the model's top pick at episode 4
EXIT = G.groupby("castaway")["episode"].max()
FAV_TOP = [e for e in range(1, 7) if rank(FAVORITE, e) == 1]
QUIET = range(2, 6)  # the four under-the-radar episodes
CONF = player(WINNER)["conf_ep"].astype(int)
RANKS = {e: rank(WINNER, e) for e in range(1, LAST_EP + 1)}
FINAL = at(LAST_EP)
FINAL_P = float(FINAL["win_prob"].iloc[0])

assert all(rating(FAVORITE, e) and rating(FAVORITE, e)[:2] == ("OTT", "N")
           for e in range(1, int(EXIT[FAVORITE]) + 1)), "the ep-4 favorite wasn't loud and negative"
assert len(FAV_TOP) == 2 and FAV_TOP[1] == FAV_TOP[0] + 1
assert all(rating(WINNER, e)[0] == "UTR" for e in QUIET)
assert all(rating(WINNER, e) is None or rating(WINNER, e)[1] != "N"
           for e in range(1, LAST_EP + 1)), "the winner got a negative rating"
assert CONF.min() >= 1, "the winner had a silent episode"
assert FINAL["castaway"].iloc[0] == WINNER, "the model's last pick wasn't the winner"
assert RANKS[2] == max(RANKS.values()), "her low point wasn't episode 2"


def finale_ranks() -> list[tuple[int, int | None, int]]:
    """Season, where the real winner ranked, and how many were left, at each
    season's last snapshot: going into the finale, 3 to 6 players."""
    out = []
    for s, g in PREDS.groupby("season"):
        last = at(int(g["episode"].max()), g)
        hit = last.index[last["is_winner"]]
        out.append((int(s), int(hit[0]) + 1 if len(hit) else None, len(last)))
    return out


FINALES = finale_ranks()
CALLED = sum(r == 1 for _, r, _ in FINALES)
TOP3 = sum(bool(r) and r <= 3 for _, r, _ in FINALES)
# what a random guess gets from the same fields: one name, or three
CHANCE1 = sum(1 / n for *_, n in FINALES)
CHANCE3 = sum(min(1, 3 / n) for *_, n in FINALES)
FIELD_MIN = min(n for *_, n in FINALES)
FIELD_MAX = max(n for *_, n in FINALES)
assert 1.8 < CALLED / CHANCE1 < 2.5, "the copy says about twice a random guess"

# the new era, for the two rules the model learned there
NEW = PREDS[PREDS["era"] == "new"]
N_NEW = NEW["season"].nunique()
LEADER_WINS = sum(  # the confessional leader through episode 4 went on to win
    bool(g[g["episode"] == 4].sort_values("conf_share_cum", ascending=False)["is_winner"].iloc[0])
    for _, g in NEW.groupby("season")
)
SILENT_WINNERS = sum(
    int(g.loc[g["is_winner"], "zero_conf_eps"].max() > 0) for _, g in NEW.groupby("season")
)
assert LEADER_WINS == 0

# share of rated episodes edited complex, at each player's last snapshot, in
# the seasons with week-of-airing edgic
_last = PREDS.sort_values("episode").groupby(["season", "castaway"]).tail(1)
_rated = _last[_last["edgic_available"] > 0]
CP_WIN = float(_rated.loc[_rated["is_winner"], "cp_share"].mean())
CP_REST = float(_rated.loc[~_rated["is_winner"], "cp_share"].mean())
N_EDGIC = _rated["season"].nunique()
assert CP_WIN > CP_REST

N_FEATURES = len(build_mod.feature_columns(pd.read_parquet(config.PROCESSED_DIR / "features.parquet")))


def by_quarter() -> list[tuple[float, float]]:
    """How often the real winner is in the model's top three, and how often a
    random pick of three would be, over each quarter of the season."""
    w = PREDS.copy()
    w["r"] = w.groupby(["season", "episode"])["win_prob"].rank(ascending=False, method="first")
    w = w[w["is_winner"]]
    q = pd.cut(w["episode_frac"], [0, 0.25, 0.5, 0.75, 1.0001], labels=False, include_lowest=True)
    return [((g["r"] <= 3).mean(), (3 / g["n_alive"]).clip(upper=1).mean())
            for _, g in w.groupby(q)]


QUARTERS = by_quarter()


# ---------------------------------------------------------------- the banner


def text_width(s: str, key: tuple[str, int], size: float, track: float = 0) -> float:
    """Advance width of `s` in one of the embedded faces, in screen units."""
    font = TTFont(io.BytesIO(_static(key)))
    cmap, hmtx = font.getBestCmap(), font["hmtx"]
    units = sum(hmtx[cmap[ord(ch)]][0] for ch in s)
    return units * size / font["head"].unitsPerEm + track * (len(s) - 1)


# the logo's silhouette: one flame curling right, a lick off each shoulder
FLAME_SHAPE = [
    "........x.....",
    ".......xx.....",
    "......xxx.....",
    "..x..xxxx.....",
    "..xx.xxxxx.x..",
    "..xxxxxxxx.xx.",
    "..xxxxxxxxxxx.",
    "..xxxxxxxxxxx.",
    ".xxxxxxxxxxxx.",
    ".xxxxxxxxxxxxx",
    ".xxxxxxxxxxxxx",
    ".xxxxxxxxxxxxx",
    ".xxxxxxxxxxxxx",
    ".xxxxxxxxxxxxx",
    "..xxxxxxxxxxx.",
    "..xxxxxxxxxxx.",
    "...xxxxxxxxx..",
    ".....xxxxx....",
]
# outline to core: the wordmark's coral on the outside, cream in the heart
FLAME_RAMP = ["#8c2f12", "#ef5a35", "#f5913a", "#ffc94f", "#fff1c9"]


def ml_flame(art, x0, top):
    """The logo: a little flame in glasses, because it reads the edit for a
    living. Coloured by depth, so the layers of the flame fall out of the
    silhouette on their own."""
    cells = {(x, y) for y, row in enumerate(FLAME_SHAPE) for x, ch in enumerate(row) if ch == "x"}
    depth, ring_, d = {}, {c for c in cells if any((c[0] + dx, c[1] + dy) not in cells
                                                  for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}, 0
    while ring_:
        for c in ring_:
            depth[c] = d
        d += 1
        rest = cells - set(depth)
        ring_ = {c for c in rest if any((c[0] + dx, c[1] + dy) in depth
                                        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    # a soft warm glow behind it
    gx, gy = x0 + 7, top + 11
    for y in range(top - 6, top + len(FLAME_SHAPE) + 4):
        for x in range(x0 - 8, x0 + 23):
            r = math.hypot(x - gx, (y - gy) * 0.9) / 14
            if r < 1:
                art.put(x, y, beach.rgb("#ffd59a"), 0.28 * (1 - r) ** 2)
    for (x, y), k in depth.items():
        k = min(k, len(FLAME_RAMP) - 1)
        if k == 4 and y < 15:  # the heart sits low, like a real flame
            k = 3
        art.put(x0 + x, top + y, beach.rgb(FLAME_RAMP[k]))
    # the face: round glasses, eyes glancing right, blush, a small smile
    navy, lens = beach.rgb(NAVY), beach.rgb("#fffaf0")
    for lx in (2, 8):
        for dx in range(4):
            for dy in range(4):
                if dx in (0, 3) and dy in (0, 3):
                    continue
                frame = dx in (0, 3) or dy in (0, 3)
                art.put(x0 + lx + dx, top + 9 + dy, navy if frame else lens)
        art.put(x0 + lx + 2, top + 11, navy)
    art.put(x0 + 6, top + 10, navy)
    art.put(x0 + 7, top + 10, navy)
    blush = beach.rgb("#f07a7a")
    art.put(x0 + 2, top + 14, blush, 0.75)
    art.put(x0 + 11, top + 14, blush, 0.75)
    mouth = beach.rgb("#8c2f12")
    for x, y in ((6, 14), (7, 14)):
        art.put(x0 + x, top + y, mouth)
    art.put(x0 + 5, top + 13, mouth, 0.8)
    art.put(x0 + 8, top + 13, mouth, 0.8)
    for x, y, c in ((13, 1, "#ffc94f"), (11, -2, "#f5913a")):  # two sparks
        art.put(x0 + x, top + y, beach.rgb(c))


def banner():
    """snuffml at golden hour: a setting sun, its path on the sea, two islands."""
    h = 300
    T = THEMES["golden"]
    art = Art(h, T)
    rows = art.rows
    L = beach.light_at(0.62)
    hz = 56
    for y in range(hz):
        for x in range(C):
            art.buf[y, x] = beach.band(L["sky"], (y / hz) ** 1.15, x, y)
    sx, sy, sr = C // 2, hz, 14
    for y in range(sy - 34, hz):
        for x in range(sx - 40, sx + 41):
            d = math.hypot(x - sx, (y - sy) * 1.15)
            if d <= sr:
                art.put(x, y, L["sunRim"] if d > sr - 1.3 else L["sunCore"])
            elif d < 34 and beach.dith(x, y, (1 - d / 34) * 0.55):
                art.put(x, y, L["halo"], 0.35)
    for y in range(hz, hz + 12):
        t_ = (y - hz) / 11
        for x in range(C):
            art.buf[y, x] = beach.band(L["sea"], t_, x, y)
            if abs(x - sx) < 6 + t_ * 18 and beach.hsh(x * 7, y) > 0.42 + t_ * 0.2:
                art.buf[y, x] = beach.mix(art.buf[y, x], L["path"], 0.85 - t_ * 0.35)
            elif beach.hsh(x, y * 3) > 0.97:
                art.buf[y, x] = L["glint"]
    for x in range(C):
        reach = max(0, round(1 + math.sin(x * 0.11) * 1.2 + math.sin(x * 0.031) * 0.8))
        for y in range(hz + 12, hz + 13 + reach):
            art.put(x, y, L["foamEdge"] if y == hz + 12 + reach else L["foam"], 0.85)
    for y in range(hz + 13, rows):
        t_ = (y - hz - 13) / max(1, rows - hz - 14)
        for x in range(C):
            c = beach.band(L["sand"], t_ * 0.6, x, y)
            if beach.hsh(x, y) > 0.985:
                c = beach.mix(c, beach.rgb("#ffffff"), 0.15)
            art.buf[y, x] = c

    def hump(cx, w, ht):
        for x in range(cx - w, cx + w + 1):
            k = 1 - ((x - cx) / w) ** 2
            for y in range(hz - round(ht * k), hz + 1):
                art.put(x, y, L["sil"])

    def palm(name, x0, y0):  # the site's palms at half size, as silhouettes
        g = GRIDS[name]
        for r in range(0, len(g), 2):
            for c in range(0, len(g[0]), 2):
                if g[r][c] != ".":
                    art.put(x0 + c // 2, y0 + r // 2, L["sil"])

    hump(16, 22, 4)
    palm("PALM_TALL", 2, hz - 29)
    palm("PALM", 17, hz - 22)
    hump(C - 14, 18, 3)
    palm("PALM_TALL", C - 24, hz - 28)

    # the word and the logo, centred together
    size, track, gap = 88, -2.5, 18
    word = text_width("snuffml", ("headline", 600), size, track)
    logo_w = 14 * PX
    left = (W - (word + gap + logo_w)) / 2
    ml_flame(art, round((left + word + gap) / PX), 8)

    o = svg_open(h, "snuffml")
    USED.setdefault(("headline", 600), set()).update("snuffml")
    tx = left
    for dy, fill, op in ((3, "#fff4dc", 0.5), (0, NAVY, 1)):
        o.append(f'<text x="{tx:.1f}" y="{104 + dy}" font-family="{STACK["headline"]}" '
                 f'font-size="{size}" font-weight="600" font-style="italic" fill="{fill}" '
                 f'opacity="{op}" letter-spacing="{track}">snuffml</text>')
    o.append(t(W / 2, 158, "predicting who wins survivor from how the show is edited", size=20,
               fill="#24324d", anchor="middle"))
    finish("banner.svg", o, art, h, T)


# ---------------------------------------------------------------- the story


def meet():
    """This is Rachel: the whole cast at midday, her ringed."""
    h = 296
    T = THEMES["day"]
    art = Art(h, T)
    L = beach.light_at(T["p"])
    horizon(art, L, sky=30, sea=4, sand=39, fade_bot=6, sea_x=0.18)
    # tribes left to right, the winner's tribe last so she lands right of centre
    first = G[G["episode"] == 1]
    tribes = sorted(first.groupby("tribe")["castaway"].apply(sorted).items(),
                    key=lambda kv: WINNER in kv[1])
    cast = [n for _, names in tribes for n in names]
    poses = ["IDLE_A", "TALK_A", "IDLE_B", "IDLE_A", "TALK_B", "IDLE_B"]
    step, gap, room = 11, 5, 7  # room: clear space either side of her for the ring
    x = (C - (len(cast) * step + 2 * gap + 2 * room)) // 2
    base = 66
    rust = beach.rgb(FLAME)
    for i, who in enumerate(cast):
        if i and i % 6 == 0:
            x += gap
        if who == WINNER:
            x += room
            person(art, x, base, body("IDLE_A", gender(who)), colour=rust)
            spot = (x + 5, base - 9)
            x += step + room
            continue
        person(art, x, base, castaway(poses[i % 6], i % len(LOOKS), gender(who)), flip=i % 2 == 1)
        x += step
    ring(art, spot[0], spot[1], 13, rust)

    o = svg_open(h, f"this is {WINNER.lower()}")
    headline(o, TX, 74, [("this is ", ""), (WINNER.lower(), "a"), (".", "b")], T)
    o.append(kicker(TX + 4, 108, f"the winner of survivor {SEASON}", fill=T["ink"]))
    ax, ay = spot[0] * PX + 2, (spot[1] - 15) * PX
    o.append(f'<path d="M{TX + 420},62 C{ax - 40},40 {ax + 30},{ay - 70} {ax + 6},{ay - 4}" '
             f'fill="none" stroke="{FLAME}" stroke-width="2.4" stroke-linecap="round" '
             'stroke-dasharray="1 7"/>')
    o.append(f'<path d="M{ax - 4},{ay - 14} L{ax + 6},{ay - 2} L{ax + 16},{ay - 13}" fill="none" '
             f'stroke="{FLAME}" stroke-width="2.6" stroke-linecap="round" '
             'stroke-linejoin="round"/>')
    finish("1-this-is-rachel.svg", o, art, h, T)


PLOT_X0, PLOT_X1 = 190, W - 40
CELL = (PLOT_X1 - PLOT_X0) / LAST_EP


def ep_x(e: int) -> float:
    return PLOT_X0 + CELL * (e - 0.5)


def episode_axis(o, y, T):
    o.append(t(TX, y, "episode", family="mono", fill=T["faint"]))
    for e in range(1, LAST_EP + 1):
        o.append(t(ep_x(e), y, e, family="mono", fill=T["faint"], anchor="middle"))


EDGIC_TINT = {"CP": FLAME, "MOR": "#c9ab7f", "UTR": "#e4d9c3", "OTT": SEA, "INV": "#d9d0bf"}


def edit():
    """Her edgic, episode by episode, over the loud favorite's."""
    h = 356
    T = THEMES["afternoon"]
    art, top = stage(h, T, sea_x=0.86)
    o = svg_open(h, "how the show edited her")
    headline(o, TX, 70, [("how the show ", ""), ("edited", "a"), (" her.", "")], T)
    o.append(kicker(TX + 4, 102, "edgic: fans rate every player's edit, every episode",
                    fill=T["ink"]))
    episode_axis(o, top + 22, T)
    for r, who in enumerate((WINNER, FAVORITE)):
        y = top + 40 + r * 62
        o.append(title(TX, y + 30, who.lower(), T, fill=T["accent"] if who == WINNER else None))
        for e in range(1, LAST_EP + 1):
            rt = rating(who, e)
            x = ep_x(e) - CELL / 2 + 4
            if rt is None:
                if e == int(EXIT[who]) + 1:
                    o.append(t(x + 4, y + 30, f"out after {e - 1}", family="mono",
                               fill=T["faint"]))
                continue
            col = EDGIC_TINT[rt[0]]
            block(art, round(x / PX), round(y / PX), round((CELL - 8) / PX), 11, beach.rgb(col))
            tone = {"P": "+", "N": "−"}.get(rt[1] or "", "")
            o.append(t(ep_x(e), y + 28, rt[0] + tone, family="mono", anchor="middle",
                       fill=ON_FLAME if luminance(col) < 0.55 else NAVY))
    legend = [("UTR", "under the radar"), ("MOR", "middle of the road"),
              ("CP", "she's the story"), ("OTT", "loud"), ("+ −", "good, bad")]
    x = TX
    for code, words in legend:
        o.append(t(x, h - 26, code, family="mono", fill=T["ink"]))
        x += mono_width(code) + 8
        o.append(t(x, h - 26, words, fill=T["muted"]))
        x += len(words) * 8.4 + 26
    assert x < W - 20, "the edgic legend runs off the edge"
    finish("2-how-the-show-edited-her.svg", o, art, h, T)


def talk():
    """Her confessionals as bricks, one per confessional, over the cast average."""
    h = 360
    T = THEMES["golden"]
    art, top = stage(h, T, sea_x=0.86)
    avg = G.groupby("episode")["conf_ep"].mean()
    q = list(QUIET)
    o = svg_open(h, "quiet, never silent")
    headline(o, TX, 70, [("quiet, never ", ""), ("silent", "a"), (".", "b")], T)
    o.append(kicker(TX + 4, 102, "her confessionals, episode by episode", fill=T["ink"]))
    unit = 2  # art rows per confessional
    floor = (h - 44) // PX
    bw = round((CELL - 20) / PX)
    hero, ink = beach.rgb(T["hero"]), beach.rgb(T["ink"])
    assert (CONF.max() + 2) * unit * PX < floor * PX - top, "the bricks hit the sky"
    for e, n in CONF.items():
        x = round(ep_x(e) / PX) - bw // 2
        for k in range(n):
            block(art, x, floor - (k + 1) * unit, bw, unit,
                  beach.mix(hero, beach.rgb("#ffffff"), 0.12 * (k % 2)), shade=0.15)
        ay = floor - round(avg[e] * unit)
        for xx in range(x - 2, x + bw + 2, 2):
            art.put(xx, ay, ink)
        o.append(t(ep_x(e), min(floor - n * unit, ay) * PX - 8, n, family="mono",
                   fill=T["accent"], anchor="middle"))
    episode_axis(o, h - 16, T)
    x0, x1 = ep_x(q[0]) - CELL / 2 + 6, ep_x(q[-1]) + CELL / 2 - 6
    by = (floor - 10 * unit) * PX
    o.append(f'<path d="M{x0},{by + 8} V{by} H{x1} V{by + 8}" fill="none" stroke="{T["ink"]}" '
             'stroke-width="2"/>')
    o.append(t((x0 + x1) / 2, by - 10, "the quiet stretch", fill=T["ink"], anchor="middle"))
    ly = (floor - 12 * unit) * PX
    o.append(f'<path d="M{TX},{ly} h28" stroke="{T["ink"]}" stroke-width="4" '
             'stroke-dasharray="4 4"/>')
    for k, line in enumerate(("cast average", "one brick = one", "confessional")):
        o.append(t(TX, ly + 26 + k * 21, line, fill=T["muted"]))
    finish("3-quiet-never-silent.svg", o, art, h, T)


def odds():
    """Her rank after every episode, as a pixel step line."""
    h = 340
    T = THEMES["dusk"]
    art, top = stage(h, T, sea_x=0.86)
    worst = max(RANKS.values())
    o = svg_open(h, "the model caught on")
    headline(o, TX, 70, [("the model ", ""), ("caught on", "a"), (".", "b")], T)
    o.append(kicker(TX + 4, 102, "her rank among the players still in, after each episode",
                    fill=T["ink"]))
    y1, yn = top + 34, h - 60

    def ry(r):
        return y1 + (r - 1) / (worst - 1) * (yn - y1)

    for r in (1, worst):
        o.append(t(PLOT_X0 - 36, ry(r) + 6, ordinal(r), family="mono", fill=T["faint"],
                   anchor="end"))
    for x in range(round(PLOT_X0 / PX), round(PLOT_X1 / PX), 3):
        art.put(x, round(ry(1) / PX), beach.rgb(T["faint"]))
    hero = beach.rgb(T["hero"])
    pts = [(round(ep_x(e) / PX), round(ry(r) / PX)) for e, r in RANKS.items()]
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        mid = (xa + xb) // 2
        for x in range(xa, mid + 1):
            art.put(x, ya, hero)
        for y in range(min(ya, yb), max(ya, yb) + 1):
            art.put(mid, y, hero)
        for x in range(mid, xb + 1):
            art.put(x, yb, hero)
    for x, y in pts:
        block(art, x - 1, y - 1, 3, 3, hero, shade=0.25)
    episode_axis(o, h - 16, T)
    for e in (1, LAST_EP):
        o.append(t(ep_x(e), ry(RANKS[e]) - 14, ordinal(RANKS[e]), family="mono",
                   fill=T["accent"], anchor="middle"))
    finish("4-the-model-caught-on.svg", o, art, h, T)


def seasons():
    """One square per season: where the real winner ranked at the finale."""
    h = 290
    T = THEMES["night"]
    art, top = stage(h, T, sea_x=0.86)
    o = svg_open(h, "every finale")
    headline(o, TX, 70, [("it called ", ""), (f"{CALLED} of {N_SEASONS}", "a"),
                         (" winners.", "")], T)
    o.append(kicker(TX + 4, 102, f"going into every finale · a random guess gets about "
                                 f"{round(CHANCE1)}", fill=T["ink"]))
    x0, size, gap = round(TX / PX), 3, 1
    sy = round((top + 40) / PX)
    tone = {1: beach.rgb(T["mark"]), 2: beach.rgb(T["tan"]), 3: beach.rgb(T["tan"])}
    for i, (s, r, _) in enumerate(FINALES):
        x = x0 + i * (size + gap)
        if r and r <= 3:
            block(art, x, sy, size, size * 2 + 1, tone[r], shade=0.2)
        else:
            for y in range(sy, sy + size * 2 + 1):
                for xx in range(x, x + size):
                    if y in (sy, sy + size * 2) or xx in (x, x + size - 1):
                        art.put(xx, y, beach.rgb(T["muted"]))
        if s == SEASON:
            cx = (x + 1) * PX + 2
            o.append(f'<path d="M{cx - 7},{(sy - 4) * PX} l7,10 l7,-10" fill="none" '
                     f'stroke="{T["hero"]}" stroke-width="2.6" stroke-linejoin="round"/>')
            o.append(t(cx, (sy - 6) * PX, WINNER.lower(), family="mono", fill=T["accent"],
                       anchor="middle"))
    ly = (sy + size * 2 + 1) * PX + 36
    items = [(T["mark"], f"called it, {CALLED}"), (T["tan"], f"2nd or 3rd, {TOP3 - CALLED}"),
             (None, f"missed, {N_SEASONS - TOP3}")]
    x = TX
    for col, words in items:
        if col is None:
            o.append(f'<rect x="{x + 1}" y="{ly - 13}" width="12" height="14" fill="none" '
                     f'stroke="{T["muted"]}" stroke-width="2"/>')
        else:
            o.append(f'<rect x="{x}" y="{ly - 14}" width="14" height="16" fill="{col}"/>')
        o.append(t(x + 22, ly, words, fill=T["muted"]))
        x += 22 + len(words) * 8.6 + 30
    o.append(t(TX, ly + 30, f"a random guess: about {round(CHANCE1)} called, about "
                            f"{round(CHANCE3)} in the top three", family="mono", fill=T["faint"]))
    o.append(t(W - 40, ly + 30, f"one square per season, 1 to {N_SEASONS}", family="mono",
               fill=T["faint"], anchor="end"))
    finish("5-every-finale.svg", o, art, h, T)


# ---------------------------------------------------------------- how it works


def arrow(o, x0, y0, x1, y1, colour):
    """A dotted pixel-ish arrow, the same hand as the one in "this is rachel."."""
    mx = (x0 + x1) / 2
    o.append(f'<path d="M{x0},{y0} C{mx},{y0} {mx},{y1} {x1 - 4},{y1}" fill="none" '
             f'stroke="{colour}" stroke-width="2.4" stroke-linecap="round" '
             'stroke-dasharray="1 7"/>')
    o.append(f'<path d="M{x1 - 12},{y1 - 8} L{x1 - 2},{y1} L{x1 - 12},{y1 + 8}" fill="none" '
             f'stroke="{colour}" stroke-width="2.6" stroke-linecap="round" '
             'stroke-linejoin="round"/>')


def panel(art, x, y, w, h, T):
    """A slightly darker paper tile with a pixel edge, in screen units."""
    paper = beach.rgb(T["paper"])
    tint = beach.mix(paper, beach.rgb("#ffffff"), 0.07) if T["dark"] else \
        beach.mix(paper, beach.rgb("#8a6a3a"), 0.08)
    block(art, round(x / PX), round(y / PX), round(w / PX), round(h / PX), tint, shade=0.06)


def inputs():
    """What goes in, and what comes out."""
    h = 420
    T = THEMES["morning"]
    art, top = stage(h, T, sea_x=0.5)
    o = svg_open(h, "what goes in")
    headline(o, TX, 70, [("what goes ", ""), ("in", "a"), (".", "b")], T)
    o.append(kicker(TX + 4, 102, f"{N_FEATURES} numbers per player, after every episode",
                    fill=T["ink"]))
    rows = [
        ("confessionals", "who talks, and how much"),
        ("edgic", "the fans' rating, week of airing"),
        ("the game", "votes, immunity, advantages"),
    ]
    tx, tw, th, y0 = TX, 300, 64, top + 26
    for i, (name, line) in enumerate(rows):
        y = y0 + i * (th + 14)
        panel(art, tx, y, tw, th, T)
        ix, iy = round((tx + 14) / PX), round(y / PX)
        if i == 0:
            speech(art, ix, iy + 4, 11, 7, 3)
        elif i == 1:
            block(art, ix, iy + 4, 6, 7, beach.rgb(FLAME))
            block(art, ix + 7, iy + 4, 5, 7, beach.rgb("#e4d9c3"))
        else:
            stamp(art, ix, iy + 2, NECKLACE)
        o.append(title(tx + 74, y + 30, name, T, size=22))
        o.append(t(tx + 74, y + 52, line, fill=T["muted"]))
        arrow(o, tx + tw + 8, y + th / 2, 446, y0 + 1.5 * th + 14, T["ink"])
    mx, mw, my, mh = 450, 220, y0 + 22, 3 * th + 28 - 44
    panel(art, mx, my, mw, mh, T)
    o.append(title(mx + mw / 2, my + 40, "the model", T, size=24, anchor="middle"))
    for k, line in enumerate(("logistic regression,", "trained on every other",
                              "season, never this one")):
        o.append(t(mx + mw / 2, my + 70 + k * 22, line, fill=T["muted"], anchor="middle"))
    arrow(o, mx + mw + 8, my + mh / 2, 736, my + mh / 2, T["ink"])
    # what comes out: odds that add up to 100%, for real, from the last episode
    ox = 740
    o.append(t(ox, y0 + 10, "odds that add to 100%", weight=700, fill=T["ink"]))
    o.append(t(ox, y0 + 32, f"season {SEASON}, episode {LAST_EP}", family="mono",
               fill=T["faint"]))
    assert abs(FINAL["win_prob"].sum() - 1) < 1e-6
    for k, row in FINAL.iterrows():
        y = y0 + 64 + k * 34
        me = row["castaway"] == WINNER
        o.append(t(ox, y + 13, row["castaway"].lower(), family="mono",
                   fill=T["accent"] if me else T["ink"]))
        bx = ox + 90
        bw = max(1, round(row["win_prob"] * 110 / PX))
        block(art, round(bx / PX), round(y / PX), bw, 4,
              beach.rgb(T["hero"] if me else T["tan"]), shade=0.15)
        o.append(t(bx + bw * PX + 8, y + 13, f"{row['win_prob']:.0%}", family="mono",
                   fill=T["accent"] if me else T["muted"]))
    finish("6-what-goes-in.svg", o, art, h, T)


def blind():
    """Leave one season out, and only what has aired."""
    h = 380
    T = THEMES["late"]
    art, top = stage(h, T, sea_x=0.5)
    o = svg_open(h, "it never sees the answer")
    headline(o, TX, 70, [("it never sees the ", ""), ("answer", "a"), (".", "b")], T)
    o.append(kicker(TX + 4, 102, "two rules every prediction here follows", fill=T["ink"]))
    rx = 400
    # rule 1: one season held out
    y = top + 40
    o.append(title(TX, y + 4, "one season held out", T, size=22))
    for k, line in enumerate(("train on the rest, predict this one,",
                              f"once for each of the {N_SEASONS}")):
        o.append(t(TX, y + 28 + k * 21, line, fill=T["muted"]))
    step = (W - 40 - rx) / N_SEASONS
    for i in range(N_SEASONS):
        x = round((rx + i * step) / PX)
        if i + 1 == SEASON:
            hero = beach.rgb(T["hero"])
            for yy in range(round(y / PX) - 3, round(y / PX) + 5):
                for xx in range(x - 1, x + 3):
                    if yy in (round(y / PX) - 3, round(y / PX) + 4) or xx in (x - 1, x + 2):
                        art.put(xx, yy, hero)
            o.append(t(x * PX + 12, y + 44, f"season {SEASON}, hidden", family="mono",
                       fill=T["accent"], anchor="end"))
        else:
            block(art, x, round(y / PX) - 2, 2, 6, beach.rgb(T["ink"]), shade=0.2)
    # rule 2: only what has aired
    y = top + 160
    now = 6
    o.append(title(TX, y + 4, "only what has aired", T, size=22))
    for k, line in enumerate(("a test scrambles every future episode",
                              "and checks nothing changes")):
        o.append(t(TX, y + 28 + k * 21, line, fill=T["muted"]))
    step = (W - 40 - rx) / LAST_EP
    for e in range(1, LAST_EP + 1):
        x = round((rx + (e - 1) * step + 6) / PX)
        w = round((step - 12) / PX)
        yy = round(y / PX) - 3
        if e <= now:
            block(art, x, yy, w, 7, beach.rgb(T["tan"]), shade=0.15)
        else:
            for a in range(yy, yy + 7):
                for b in range(x, x + w):
                    if beach.dith(b, a, 0.35):
                        art.put(b, a, beach.rgb(T["faint"]), 0.6)
        o.append(t(rx + (e - 0.5) * step, y + 46, e, family="mono", fill=T["faint"],
                   anchor="middle"))
    nx = rx + now * step
    o.append(f'<line x1="{nx}" y1="{y - 26}" x2="{nx}" y2="{y + 28}" stroke="{T["hero"]}" '
             'stroke-width="2.4" stroke-dasharray="1 5" stroke-linecap="round"/>')
    o.append(t(nx - 8, y - 22, "aired", family="mono", fill=T["ink"], anchor="end"))
    o.append(t(nx + 8, y - 22, "not yet", family="mono", fill=T["faint"]))
    finish("7-it-never-sees-the-answer.svg", o, art, h, T)


def sharper():
    """Top-three rate by quarter of the season, against chance."""
    h = 420
    T = THEMES["golden"]
    art, top = stage(h, T, sea_x=0.5)
    final = (TOP3 / N_SEASONS, CHANCE3 / N_SEASONS)
    bars = [*QUARTERS, final]
    labels = ["first quarter", "second", "third", "last quarter", "finale"]
    o = svg_open(h, "sharper every week")
    headline(o, TX, 70, [("sharper every ", ""), ("week", "a"), (".", "b")], T)
    o.append(kicker(TX + 4, 102, "how often the real winner is in its top three",
                    fill=T["ink"]))
    floor = (h - 44) // PX
    tall = floor - round((top + 40) / PX)
    x0, x1 = 300, W - 60
    cell = (x1 - x0) / len(bars)
    bw = round((cell - 44) / PX)
    hero, ink = beach.rgb(T["hero"]), beach.rgb(T["ink"])
    for i, ((rate, chance), lab) in enumerate(zip(bars, labels)):
        cx = x0 + cell * (i + 0.5)
        x = round(cx / PX) - bw // 2
        hh = round(rate * tall)
        last = i == len(bars) - 1
        block(art, x, floor - hh, bw, hh, beach.mix(beach.rgb(T["paper"]), hero,
                                                     1.0 if last else 0.4 + 0.13 * i))
        o.append(t(cx, (floor - hh) * PX - 10, f"{rate:.0%}", family="mono",
                   fill=T["accent"], anchor="middle"))
        o.append(t(cx, h - 16, lab, family="mono", fill=T["faint"], anchor="middle"))
        if chance is not None:
            cy = floor - round(chance * tall)
            for xx in range(x - 2, x + bw + 2, 2):
                art.put(xx, cy, ink)
    o.append(f'<path d="M{TX},{top + 70} h28" stroke="{T["ink"]}" stroke-width="4" '
             'stroke-dasharray="4 4"/>')
    for k, line in enumerate(("a random pick of three", "", "early on it's barely",
                              "better than a guess.", "by the finale it's",
                              "well ahead of one.")):
        if line:
            o.append(t(TX, top + 96 + k * 21, line, fill=T["muted"]))
    assert QUARTERS[0][0] - QUARTERS[0][1] < 0.1, "the early-season line says barely better"
    assert final[0] - final[1] > 0.2, "the finale line says well ahead of a guess"
    finish("8-sharper-every-week.svg", o, art, h, T)


def learned():
    """Three rules the model picked up, each a little scene on the beach at
    night, lit by its own torch, with the site's wildlife about."""
    h = 420
    T = THEMES["night"]
    art, top = stage(h, T, sea_x=0.5)
    L = beach.light_at(T["p"])
    o = svg_open(h, "what it learned")
    headline(o, TX, 70, [("what it ", ""), ("learned", "a"), (".", "b")], T)
    o.append(kicker(TX + 4, 102, "three patterns behind most of its calls", fill=T["ink"]))
    cols = [
        ("loud early, out early", f"0 of {N_NEW}",
         ("new-era seasons won by the", "confessional leader at episode 4")),
        ("quiet, never silent", f"{SILENT_WINNERS} of {N_NEW}",
         ("new-era winners who had an", "episode with zero confessionals")),
        ("the story's about them", f"{CP_WIN:.0%} vs {CP_REST:.0%}",
         ("episodes rated complex, winners", f"vs everyone else ({N_EDGIC} seasons)")),
    ]
    cw = (W - TX - 40) / 3
    base = round((top + 116) / PX)
    xs = [round((TX + i * cw + 60) / PX) for i in range(3)]
    torches = [(cx - 6, base - 17) for cx in xs]

    # a moonlit strip of beach under all three, dithered into the night paper
    for y in range(base - 7, base + 6):
        edge = min(y - (base - 7), base + 5 - y) / 3
        for x in range(C):
            if beach.dith(x, y, min(1, edge)):
                art.put(x, y, beach.band(L["sand"][:4], (y - base + 7) / 12, x, y))
    # torchlight pooling on the sand
    warm = beach.rgb("#ffb547")
    for tx_, ty in torches:
        for y in range(ty - 22, base + 6):
            for x in range(tx_ - 26, tx_ + 27):
                d = math.hypot(x - tx_, (y - ty) * 1.25) / 26
                if d < 1 and beach.dith(x, y, (1 - d) * 0.8):
                    art.put(x, y, warm, 0.12 * (1 - d) ** 1.5)

    night = beach.rgb("#1c2652")

    def lit(grid, x0, y0, *, flip=False):
        """Sprite pixels, darkened by the night except where a torch reaches."""
        for r, row in enumerate(grid):
            for c, ch in enumerate(row):
                if ch == ".":
                    continue
                x, y = x0 + (len(row) - 1 - c if flip else c), y0 + r
                k = max(1 - math.hypot(x - tx_, y - ty) / 20 for tx_, ty in torches)
                col = beach.rgb(PAL[ch])
                art.put(x, y, beach.mix(beach.mix(col, night, 0.6), col, min(1, max(0, k) * 1.7)))

    for cx, (tx_, ty) in zip(xs, torches):
        stamp(art, tx_ - 4, base - 20, GRIDS["TORCH_LIT_A"])
    for i, cx in enumerate(xs):
        if i == 0:
            lit(castaway("TALK_B", 2), cx, base - 18)
            speech(art, cx + 9, base - 28, 16, 7, 4)
            lit(GRIDS["GRASS"], cx - 20, base - 5)
            lit(GRIDS["CRAB_A"], cx + 17, base - 5)
        elif i == 1:
            lit(castaway("SIT_A", 4, "f"), cx, base - 18)
            speech(art, cx + 6, base - 23, 5, 4, 1)
            lit(GRIDS["FERN_SMALL"], cx - 22, base - 7)
            lit(GRIDS["ROCK_SMALL"], cx + 15, base - 5)
            lit(GRIDS["LIZARD_A"], cx + 14, base - 9)
        else:
            lit(castaway("TALK_A", 3, "f"), cx, base - 18)
            for (dx, dy), col in zip(((12, -22), (19, -22), (12, -16), (19, -16)),
                                     (FLAME, FLAME, FLAME, "#c9ab7f")):
                block(art, cx + dx, base + dy, 6, 5, beach.rgb(col))
            lit(GRIDS["COCONUTS"], cx - 22, base - 6)
            lit(GRIDS["CRAB_B"], cx + 27, base - 5, flip=True)
            lit(GRIDS["DRIFTWOOD"], cx + 38, base - 6)
            lit(GRIDS["GULL_A"], cx + 44, base - 12)
        o.append(t(TX + i * cw, top + 178, cols[i][1], size=36, family="headline", weight=600,
                   fill=T["accent"], extra=' font-style="italic"'))
        o.append(t(TX + i * cw, top + 208, cols[i][0], weight=700, fill=T["ink"]))
        for k, line in enumerate(cols[i][2]):
            o.append(t(TX + i * cw, top + 232 + k * 21, line, fill=T["muted"]))
    # fireflies over the sand
    for n in range(14):
        fx = round(beach.hsh(n, 7) * (C - 40)) + 20
        fy = base - 10 - round(beach.hsh(n, 11) * 14)
        art.put(fx, fy, beach.rgb("#fff1a8"))
        art.put(fx + 1, fy, beach.rgb("#ffd86b"), 0.35)
    finish("9-what-it-learned.svg", o, art, h, T)


# ---------------------------------------------------------------- the live season


def live_season() -> dict | None:
    """The airing season's site export, or None between seasons."""
    for path in sorted((DOCS / "data" / "seasons").glob("s*.json"), reverse=True):
        d = json.loads(path.read_text())
        if d.get("live"):
            return d
    return None


def standing(d: dict, i: int) -> list[tuple[str, float]]:
    """Who's still in after the i-th aired episode, best odds first. A player
    voted out that episode still carries a number for it in the export, so
    they're dropped here: the card must never list someone already gone."""
    ep = d["episodes"][i]
    still = [(p["name"], p["probs"][i]) for p in d["players"]
             if p["probs"][i] is not None and (p["boot"] is None or p["boot"] > ep)]
    return sorted(still, key=lambda r: -r[1])


ARROW = ["...x...", "..xxx..", ".xxxxx.", "xxxxxxx", "..xxx..", "..xxx.."]


def live_card(d: dict) -> tuple[str, str]:
    """This week's top three for the airing season, with how far each moved
    since last week. No list of who's out, so it spoils nothing past the
    names still in the game."""
    h = 330
    T = THEMES["day"]
    art, top = stage(h, T, sea_x=0.82)
    season, ep = d["season"], d["episodes"][-1]
    now = standing(d, -1)
    before = {name: k for k, (name, _) in enumerate(standing(d, -2))} if len(d["episodes"]) > 1 else {}
    top3 = now[:3]
    even = 1 / len(now)
    o = svg_open(h, f"season {season}, live")
    headline(o, TX, 70, [("who wins ", ""), (f"season {season}", "a"), ("?", "b")], T)
    o.append(kicker(TX + 4, 102, f"the model's top three after episode {ep} (updated weekly)",
                    fill=T["ink"]))
    bx, span = 300, 420
    scale = span / max(top3[0][1], 2 * even)
    ex = bx + even * scale
    y0 = top + 30
    for k, (name, prob) in enumerate(top3):
        y = y0 + k * 34
        o.append(t(TX, y + 16, k + 1, family="mono", fill=T["faint"]))
        o.append(title(TX + 34, y + 18, name.lower(), T, size=22,
                       fill=T["accent"] if k == 0 else None))
        bw = max(1, round(prob * scale / PX))
        block(art, round(bx / PX), round(y / PX), bw, 5,
              beach.rgb(T["hero"] if k == 0 else T["tan"]), shade=0.15)
        o.append(t(bx + bw * PX + 10, y + 16, f"{prob:.0%}", family="mono",
                   fill=T["accent"] if k == 0 else T["muted"]))
        ax = round((W - 130) / PX)
        if name in before and before[name] != k:
            up = before[name] > k
            col = beach.rgb("#2f9e55" if up else "#d1453b")
            for r, row in enumerate(ARROW if up else ARROW[::-1]):
                for c, ch in enumerate(row):
                    if ch == "x":
                        art.put(ax + c, round(y / PX) - 1 + r, col)
            moved = abs(before[name] - k)
            o.append(t(ax * PX + 38, y + 16, f"{'up' if up else 'down'} {moved}", family="mono",
                       fill="#2f9e55" if up else "#d1453b"))
        elif name in before:
            o.append(t(ax * PX + 2, y + 16, "same", family="mono", fill=T["faint"]))
        else:
            o.append(t(ax * PX + 2, y + 16, "new", family="mono", fill=T["faint"]))
    for yy in range(round((y0 - 10) / PX), round((y0 + 3 * 34) / PX), 2):
        art.put(round(ex / PX), yy, beach.rgb(T["ink"]))
    o.append(t(ex, y0 + 3 * 34 + 20, f"even split, {even:.0%}", family="mono", fill=T["faint"],
               anchor="middle"))
    finish("live.svg", o, art, h, T)
    names = ", ".join(f"{n} {p:.0%}" for n, p in top3)
    alt = f"The model's top three for season {season} after episode {ep}: {names}"
    return alt, f"{SITE}#s{season}/ep{ep}"


def live_block() -> str:
    d = live_season()
    if d is None:
        (OUT / "live.svg").unlink(missing_ok=True)
        return ""
    alt, link = live_card(d)
    return "\n".join([
        "<!-- generated by scripts/story.py from docs/data/seasons. rerun it after each "
        "site export. -->",
        f"[![{alt}](docs/story/live.svg)]({link})",
        "",
        textwrap.fill(f"**[See the full board for season {d['season']}]({link})**. The site also "
                      "replays every finished season episode by episode, shows why the model "
                      "rates each player the way it does, and compares eras.", 79,
                      break_on_hyphens=False),
        "",
    ])


# ---------------------------------------------------------------- the README


def readme_block(pictures) -> str:
    def para(s):
        return textwrap.fill(s, 79, break_on_hyphens=False)

    out = ["<!-- generated by scripts/story.py from the backtest. edit the script, not "
           "this block. -->", "## one season, start to finish", ""]
    for kind, name, alt, text in pictures:
        if kind == "section":
            out += [f"## {name}", "", para(text), ""]
            continue
        if text:
            out += [para(text), ""]
        out += [f"![{alt}](docs/story/{name})", ""]
    out.append(para("Every season's full chart, every player's line, is in [the backtest "
                    "poster](docs/infographic.png)."))
    return "\n".join(out).rstrip() + "\n"


def write_readme(block: str, start: str = START, end: str = END) -> None:
    text = README.read_text()
    if start not in text or end not in text:
        raise SystemExit(f"README.md needs {start} and {end} around the generated section")
    head, rest = text.split(start, 1)
    _, tail = rest.split(end, 1)
    README.write_text(f"{head}{start}\n{block}{end}{tail}")
    print(f"wrote {start} in README.md")


def main() -> None:
    print(f"season {SEASON}: {WINNER} won; ep-4 favorite {FAVORITE}")
    for old in OUT.glob("*.svg"):
        old.unlink()
    for draw in (banner, meet, edit, talk, odds, seasons, inputs, blind, sharper, learned):
        draw()
    q = list(QUIET)
    lo, hi = int(CONF[q].min()), int(CONF[q].max())
    out = int(EXIT[FAVORITE])
    pictures = [
        ("pic", "1-this-is-rachel.svg",
         f"Season {SEASON}'s cast on the beach at midday, {WINNER} circled",
         f"{WINNER} won Survivor {SEASON}. The model never trained on her season, so "
         "everything below is what it actually thought at the time, one episode at a time."),
        ("pic", "2-how-the-show-edited-her.svg",
         f"{WINNER}'s edgic rating for every episode next to {FAVORITE}'s",
         "Edgic is the fans' weekly rating of every player's edit: under the radar, middle of "
         "the road, complex (the story is about you) or over the top, plus whether it reads "
         f"good or bad. {WINNER} went under the radar for episodes {q[0]} to {q[-1]} and "
         f"was mostly complex and positive after that. {FAVORITE} was over the top and "
         f"negative every single week. He was the model's #1 after episodes {FAV_TOP[0]} "
         f"and {FAV_TOP[1]}, and he went out in {out}."),
        ("pic", "3-quiet-never-silent.svg",
         f"{WINNER}'s confessionals per episode against the cast average",
         "Confessionals are the talking-head interviews. In the quiet stretch she got "
         f"{lo} to {hi} an episode, under the cast average, but never zero. That matters: "
         f"only {SILENT_WINNERS} of {N_NEW} new-era winners has had an episode with none."),
        ("pic", "4-the-model-caught-on.svg",
         f"{WINNER}'s rank after each episode, from {ordinal(RANKS[1])} to "
         f"{ordinal(RANKS[2])} and back up to {ordinal(RANKS[LAST_EP])}",
         f"So the model never wrote her off. She was {ordinal(RANKS[1])} after the "
         f"premiere, {ordinal(RANKS[2])} of {ALIVE[2]} at her low point, and climbed steadily "
         f"until its last snapshot had her first at {FINAL_P:.0%}."),
        ("pic", "5-every-finale.svg",
         f"Where the real winner ranked at all {N_SEASONS} finales: {CALLED} called, "
         f"against about {round(CHANCE1)} for a random guess",
         f"{WINNER} is one season out of {N_SEASONS}. Going into the finale, with "
         f"{FIELD_MIN} to {FIELD_MAX} players left, the model's #1 pick was the real winner "
         f"{CALLED} times. Picking a name at random gets about {round(CHANCE1)}. The winner "
         f"was in its top three {TOP3} times, against about {round(CHANCE3)} by chance."),
        ("section", "how it works", "", "The short version, in four pictures."),
        ("pic", "6-what-goes-in.svg",
         "Confessionals, edgic and game stats feed a logistic regression, which outputs "
         "odds that add to 100%",
         f"After every episode, each player still in the game becomes {N_FEATURES} numbers: "
         "how much they talk and when, how the fans rated their edit that week, and how they "
         "are playing. A logistic regression scores everyone, and the scores get rescaled "
         "within the season so they add to 100%, because there's exactly one winner. "
         "New-era seasons (41 on) also blend in a model trained on that era alone."),
        ("pic", "7-it-never-sees-the-answer.svg",
         "Leave-one-season-out training, and features built only from episodes that have "
         "aired",
         "Every number in this README is out of sample. Each season is predicted by a model "
         "that never saw it, and every feature only uses episodes that had aired by then. "
         "Edgic ratings written after a finale don't count either, because most of the "
         "charts online were made by people who already knew the winner."),
        ("pic", "8-sharper-every-week.svg",
         "How often the winner is in the model's top three, by quarter of the season, "
         "against a random pick",
         "It isn't psychic. In the first quarter of a season it's about as good as picking "
         "three names out of a hat. It gets sharper as the edit fills in, and the dotted "
         "line on each bar is what a random pick of three would get at that point."),
        ("pic", "9-what-it-learned.svg",
         "Three patterns: early confessional leaders don't win, winners are never silent, "
         "winners get complex edits",
         "Most of its calls come down to three patterns. The editors crown an early "
         "frontrunner just to take them down. Winners are rarely the loudest, but they are "
         "almost never silent. And by the end, the story is about them."),
    ]
    write_readme(readme_block(pictures))
    write_readme(live_block(), LIVE_START, LIVE_END)


if __name__ == "__main__":
    main()
