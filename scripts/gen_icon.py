#!/usr/bin/env python3
"""生成 PlanWave 应用图标源图（PNG，无第三方依赖）。

设计：深蓝→蓝渐变圆底 + 白色对勾。
运行：python scripts/gen_icon.py <输出路径.png> [尺寸，默认 1024]
"""

import math
import struct
import sys
import zlib

SIZE = 1024


def png_chunk(tag: bytes, data: bytes) -> bytes:
    raw = tag + data
    return struct.pack(">I", len(data)) + raw + struct.pack(">I", zlib.crc32(raw))


def write_png(path: str, size: int, pixels: list[list[tuple[int, int, int]]]) -> None:
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    rows = b""
    for y in range(size):
        rows += b"\x00"
        for x in range(size):
            rows += bytes(pixels[y][x])
    idat = zlib.compress(rows, 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(png_chunk(b"IHDR", ihdr))
        f.write(png_chunk(b"IDAT", idat))
        f.write(png_chunk(b"IEND", b""))


def dist_to_segment(px, py, x1, y1, x2, y2) -> float:
    dx, dy = x2 - x1, y2 - y1
    if dx == dy == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else "icon-source.png"
    size = int(sys.argv[2]) if len(sys.argv) > 2 else SIZE
    k = size / SIZE  # 设计坐标基于 1024 画布，按比例缩放
    half = size / 2
    pixels: list[list[tuple[int, int, int]]] = []
    for y in range(size):
        row: list[tuple[int, int, int]] = []
        for x in range(size):
            # 圆形底：圆外透明→白色（PNG 无 alpha 通道，用白底）
            d = math.hypot(x - half, y - half)
            if d > half - 2 * k:
                row.append((250, 250, 250))
                continue
            # 深蓝→蓝的简单渐变（左上到右下）
            t = (x + y) / (2 * size)
            r = int(37 + (59 - 37) * t)
            g = int(99 + (130 - 99) * t)
            b = int(235 + (246 - 235) * t)
            # 白色对勾（两段粗线）
            if (
                dist_to_segment(x, y, 300 * k, 530 * k, 450 * k, 680 * k) < 52 * k
                or dist_to_segment(x, y, 450 * k, 680 * k, 730 * k, 380 * k) < 52 * k
            ):
                r = g = b = 255
            row.append((r, g, b))
        pixels.append(row)
    write_png(out, size, pixels)
    print(f"icon written: {out} ({size}x{size})")


if __name__ == "__main__":
    main()
