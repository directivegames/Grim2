"""garch — building helpers preloaded into every step: windows, doors, pitched roofs, railings.

Every helper builds in a WALL frame and then turns the pieces onto one face of the building:
  face   which way the wall looks: '-y' (the front, toward the player), '+y', '-x', '+x'
  plane  the wall's outer surface on that axis, e.g. -2.0 for a front wall at y = -2.0
  cx     position ALONG the wall (local X, centre of the opening); cz = bottom of the opening
Pieces stand proud of the wall by a few centimetres, so cut no holes: put a window on a solid
wall box and it reads. Every helper returns a list of objects; join() them per material set.

Coordinates are Blender's (metres, Z up, front −Y), the same as gkit.
"""
import math

import bpy  # noqa: F401  (step scripts expect bpy-backed objects)

from gkit import _recalc_normals, add_bevel, box, mesh

__all__ = ['window', 'door', 'gable_roof', 'rail_run']

_FACE_ROT = {'-y': 0.0, '+y': 180.0, '-x': -90.0, '+x': 90.0}


def _orient(objs: list, face: str, plane: float) -> list:
    """Pieces built with X along the wall, −Y out of it, wall surface at y = 0 → turned onto `face`
    with its surface at `plane`."""
    if face not in _FACE_ROT:
        raise ValueError(f"face must be one of {sorted(_FACE_ROT)}, got {face!r}")
    a = math.radians(_FACE_ROT[face])
    ca, sa = math.cos(a), math.sin(a)
    off = (0.0, plane) if face in ('-y', '+y') else (plane, 0.0)
    for o in objs:
        x, y = o.location.x, o.location.y
        o.location.x = x * ca - y * sa + off[0]
        o.location.y = x * sa + y * ca + off[1]
        o.rotation_euler.z += a
    return objs


def window(name: str, cx: float, cz: float, w: float, h: float, frame, glass, *,
           face: str = '-y', plane: float = 0.0, sill=None, cross: bool = True, shutters=None) -> list:
    """Window on a wall: frame bars, inset glass, a sill, an optional mullion cross and shutters.
    w × h is the opening in metres (a house window is about 1.0 × 1.2, its bottom at cz ≈ 0.9)."""
    t = 0.09
    parts = [
        box(name + '_glass', (w - 0.1, 0.06, h - 0.1), at=(cx, -0.02, cz + 0.05), m=glass),
        box(name + '_fl', (t, 0.14, h), at=(cx - w / 2 + t / 2, -0.05, cz), m=frame),
        box(name + '_fr', (t, 0.14, h), at=(cx + w / 2 - t / 2, -0.05, cz), m=frame),
        box(name + '_ft', (w + 0.08, 0.16, t + 0.02), at=(cx, -0.06, cz + h - t), m=frame),
        box(name + '_sill', (w + 0.2, 0.2, 0.08), at=(cx, -0.09, cz - 0.06), m=sill or frame),
    ]
    if cross:
        parts.append(box(name + '_mv', (0.06, 0.1, h), at=(cx, -0.05, cz), m=frame))
        parts.append(box(name + '_mh', (w, 0.1, 0.06), at=(cx, -0.05, cz + h * 0.55), m=frame))
    if shutters is not None:
        for sx in (-1, 1):
            parts.append(box(name + '_sh', (w * 0.42, 0.06, h),
                             at=(cx + sx * (w / 2 + w * 0.21 + 0.04), -0.03, cz), m=shutters))
    return _orient(parts, face, plane)


def door(name: str, cx: float, cz: float, w: float, h: float, leaf, frame, *,
         face: str = '-y', plane: float = 0.0, glass=None, knob=None) -> list:
    """Door: frame, panel leaf (named <name>_leaf, so the game can swing it), optional glass light
    and knob. A front door is about 1.0 × 2.1 m."""
    parts = [
        box(name + '_frame', (w + 0.2, 0.12, h + 0.1), at=(cx, -0.03, cz), m=frame, bevel=0.015),
        box(name + '_leaf', (w, 0.12, h), at=(cx, -0.06, cz), m=leaf, bevel=0.02),
    ]
    if glass is not None:
        parts.append(box(name + '_light', (w * 0.55, 0.06, h * 0.3), at=(cx, -0.11, cz + h * 0.6), m=glass))
    if knob is not None:
        parts.append(box(name + '_knob', (0.07, 0.08, 0.07), at=(cx + w * 0.35, -0.15, cz + h * 0.47), m=knob))
    return _orient(parts, face, plane)


def _slab(name, a0, a1, lo, hi, t, m, ridge_x):
    def P(a, b, z):
        return (a, b, z) if ridge_x else (b, a, z)
    v = [P(a0, lo[0], lo[1]), P(a1, lo[0], lo[1]), P(a1, hi[0], hi[1]), P(a0, hi[0], hi[1]),
         P(a0, lo[0], lo[1] + t), P(a1, lo[0], lo[1] + t), P(a1, hi[0], hi[1] + t), P(a0, hi[0], hi[1] + t)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    o = mesh(name, v, f, m=m)
    _recalc_normals(o)
    return o


def gable_roof(name: str, span_a: tuple, span_b: tuple, eave_z: float, ridge_z: float, roof, gable, *,
               overhang: float = 0.45, thickness: float = 0.18, ridge_x: bool = True, cap=None) -> list:
    """Pitched roof over the rectangle span_a × span_b. span_a = (a0, a1) runs ALONG the ridge
    (X when ridge_x, else Y); span_b = (b0, b1) runs across it. The walls stop at eave_z; the ridge
    is at ridge_z. Gable triangles use `gable`, the two slabs `roof` (bevelled), `cap` adds a ridge
    board. A 30–40° pitch reads as a house: ridge_z − eave_z ≈ 0.6 × half the span."""
    a0, a1 = span_a
    b0, b1 = span_b
    bc, half = (b0 + b1) / 2, (b1 - b0) / 2
    slope = (ridge_z - eave_z) / half

    def P(a, b, z):
        return (a, b, z) if ridge_x else (b, a, z)
    v = [P(a0, b0, eave_z), P(a0, b1, eave_z), P(a0, bc, ridge_z), P(a1, b0, eave_z), P(a1, b1, eave_z), P(a1, bc, ridge_z)]
    g = mesh(name + '_gable', v, [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], m=gable)
    _recalc_normals(g)
    objs = [g]
    lo_z = eave_z - overhang * slope - 0.02
    for s in (-1, 1):
        slab = _slab(name + '_slab', a0 - overhang, a1 + overhang, (bc + s * (half + overhang), lo_z),
                     (bc, ridge_z + 0.02), thickness, roof, ridge_x)
        add_bevel(slab, 0.03)
        objs.append(slab)
    if cap is not None:
        L = a1 - a0 + 2 * overhang + 0.06
        objs.append(box(name + '_ridge', (L, 0.26, 0.16) if ridge_x else (0.26, L, 0.16),
                        at=P((a0 + a1) / 2, bc, ridge_z + thickness - 0.06), m=cap, bevel=0.03))
    return objs


def rail_run(name: str, p0: tuple, p1: tuple, z: float, h: float, post, rail, *,
             spacing: float = 0.16, baluster: float = 0.045, posts: bool = True) -> list:
    """Railing or picket fence from p0 to p1 ((x, y) points) standing on z: top and bottom rails,
    balusters every `spacing` metres, end posts. h ≈ 0.9–1.1 m for a balcony, 0.6–1.2 for a fence."""
    x0, y0 = p0
    x1, y1 = p1
    L = math.hypot(x1 - x0, y1 - y0)
    ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    top = 0.09
    objs = [box(name + '_top', (L + 0.1, top + 0.03, top * 0.7), at=(mx, my, z + h - top * 0.7), m=rail,
                rot=(0, 0, ang), bevel=0.015),
            box(name + '_bot', (L, top * 0.6, 0.06), at=(mx, my, z + 0.1), m=rail, rot=(0, 0, ang))]
    n = max(1, int(L / spacing))
    for i in range(1, n):
        f = i / n
        objs.append(box(name + '_bal', (baluster, baluster, h - top * 0.7 - 0.1),
                        at=(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z + 0.1), m=rail, rot=(0, 0, ang)))
    if posts:
        for (px, py) in (p0, p1):
            objs.append(box(name + '_post', (0.14, 0.14, h + 0.08), at=(px, py, z), m=post, bevel=0.02))
    return objs
