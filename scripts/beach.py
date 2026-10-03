"""The light from docs/_mock/stage.js, ported to Python so the README banners
share the site's sky: four lights (midday, golden, dusk, night) blended by a
progress value, and bayer dithering between bands. Keep this in step with
stage.js: the light keys are copied from it.
"""

from __future__ import annotations


import numpy as np

S = 4  # screen pixels per art pixel, same as the site
HORIZON = 82
BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
M32 = 0xFFFFFFFF


def rgb(h: str) -> np.ndarray:
    return np.array([int(h[i : i + 2], 16) for i in (1, 3, 5)], dtype=float)


def hsh(a: int, b: int) -> float:
    h = (a * 374761393 + b * 668265263) & M32
    h = ((h ^ (h >> 13)) * 1274126177) & M32
    return ((h ^ (h >> 16)) & M32) / 4294967296


def dith(x: int, y: int, f: float) -> bool:
    return BAYER[(y & 3) * 4 + (x & 3)] < f * 16


def mix(a, b, t):
    return a + (b - a) * t


MIDDAY = dict(
    sky=["#4f9fd3", "#5aa7d6", "#66afda", "#73b7de", "#82bfe1", "#93c8e3", "#a8d2e4", "#c3dde2"],
    sea=["#2b7ea6", "#3189b0", "#3b97b9", "#4ba6c1"],
    sand=["#e8d29b", "#e3ca90", "#ddc286", "#d5b97c", "#c9ac70", "#b89c63"],
    sil="#3f6e55", path="#fff8de", glint="#bfe6f0", foam="#e9f6f8", foamEdge="#ffffff",
    halo="#fff4c8", stars=0, dark=0, moon=0, sun=(0.66, 16, 6), sunCore="#fff7dc",
    sunRim="#ffe9a8",
)
GOLDEN = dict(
    sky=["#6e9bcb", "#7ea5cc", "#93aec8", "#adb3bd", "#cbb2a0", "#e6ad80", "#f2b46a", "#f7c46c"],
    sea=["#2c5c84", "#3c6889", "#5b7787", "#87877c"],
    sand=["#e6ba80", "#ddae73", "#d1a168", "#c5955e", "#b48756", "#9f774b"],
    sil="#3b3b3e", path="#ffd27e", glint="#e9bf86", foam="#f4e2c6", foamEdge="#fff2dc",
    halo="#ffd98a", stars=0, dark=0.3, moon=0, sun=(0.8, 60, 8), sunCore="#ffe2a0",
    sunRim="#ffb85c",
)
DUSK = dict(
    sky=["#1d2350", "#292b5d", "#3b3166", "#54386b", "#77406b", "#a04b63", "#cc6356", "#e78150"],
    sea=["#1d2951", "#283058", "#43385a", "#684358"],
    sand=["#7b5c5e", "#6e5459", "#624b54", "#57444e", "#493b46", "#362d3b"],
    sil="#19132e", path="#f39a64", glint="#7c5c7c", foam="#c9a9b9", foamEdge="#e8c8d0",
    halo="#ff9a5a", stars=0.45, dark=0.75, moon=0.25, sun=(0.85, HORIZON + 3, 9),
    sunCore="#ffb070", sunRim="#ff7a40",
)
NIGHT = dict(
    sky=["#0a0e24", "#0f1532", "#151d42", "#1c2652", "#263060", "#33386b", "#463f72", "#5d4672"],
    sea=["#121b38", "#162243", "#1b2a4e", "#213258"],
    sand=["#41435b", "#48465e", "#4c475f", "#46405a", "#3a344c", "#2a2438"],
    sil="#090d20", path="#efe4c0", glint="#2f4672", foam="#6d7fa3", foamEdge="#9fb0cf",
    halo="#3a4580", stars=1, dark=1, moon=1, sun=(0.9, HORIZON + 30, 9), sunCore="#ffb070",
    sunRim="#ff7a40",
)
# same thresholds as stage.js: midday through the early game, night at final tribal
KEYS = [(0, MIDDAY), (0.32, MIDDAY), (0.55, GOLDEN), (0.8, DUSK), (0.97, NIGHT), (1, NIGHT)]
COLOURS = ("sil", "path", "glint", "foam", "foamEdge", "halo", "sunCore", "sunRim")


def light_at(p: float) -> dict:
    j = 0
    while j < len(KEYS) - 2 and p > KEYS[j + 1][0]:
        j += 1
    (a0, A), (a1, B) = KEYS[j], KEYS[j + 1]
    t = max(0.0, min(1.0, (p - a0) / (a1 - a0))) if a1 > a0 else 0.0
    t = t * t * (3 - 2 * t)
    L = {k: [mix(rgb(c), rgb(d), t) for c, d in zip(A[k], B[k])] for k in ("sky", "sea", "sand")}
    L.update({k: mix(rgb(A[k]), rgb(B[k]), t) for k in COLOURS})
    L.update({k: A[k] + (B[k] - A[k]) * t for k in ("stars", "dark", "moon")})
    L["sun"] = tuple(a + (b - a) * t for a, b in zip(A["sun"], B["sun"]))
    return L


def band(lst, t, x, y):
    f = max(0.0, min(len(lst) - 1.001, t * (len(lst) - 1)))
    i = int(f)
    return lst[i + 1] if dith(x, y, f - i) else lst[i]
