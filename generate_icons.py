#!/usr/bin/env python3
"""
Generate PNG icons for CodeGrab extension.
Uses only Python standard library — no Pillow or other dependencies needed.
Run:  python3 generate_icons.py
"""
import struct, zlib, os, math

# Brand gradient colours (top-left → bottom-right)
COLOUR_A = (79,  70, 229)   # #4f46e5  indigo
COLOUR_B = (124, 58, 237)   # #7c3aed  violet

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def rounded_rect_mask(size, radius):
    """Return a 2-D list (row-major) of floats 0..1 — 1 inside the rounded rect."""
    mask = []
    r = radius
    for y in range(size):
        row = []
        for x in range(size):
            # Distance to nearest corner-circle centre
            cx = max(r, min(x, size - 1 - r))
            cy = max(r, min(y, size - 1 - r))
            dx, dy = x - cx, y - cy
            dist = math.sqrt(dx*dx + dy*dy)
            # Anti-alias at the edge
            alpha = max(0.0, min(1.0, r - dist + 0.5))
            row.append(alpha)
        mask.append(row)
    return mask

def make_png(size):
    radius = max(2, size // 5)          # corner radius ~20 % of size
    mask   = rounded_rect_mask(size, radius)

    rows = []
    for y in range(size):
        row_bytes = bytearray()
        for x in range(size):
            t = (x + y) / (2 * (size - 1))  # diagonal gradient 0→1
            colour = lerp(COLOUR_A, COLOUR_B, t)
            alpha  = int(round(mask[y][x] * 255))
            row_bytes += bytes([*colour, alpha])
        # PNG filter byte 0 (None) before each row
        rows.append(b'\x00' + bytes(row_bytes))

    raw   = b''.join(rows)
    idat  = zlib.compress(raw, 9)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # RGBA
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', idat)
        + chunk(b'IEND', b'')
    )

if __name__ == '__main__':
    os.makedirs('icons', exist_ok=True)
    for sz in (16, 48, 128):
        path = f'icons/icon{sz}.png'
        with open(path, 'wb') as f:
            f.write(make_png(sz))
        print(f'  Created {path}  ({sz}×{sz})')
    print('Done.')
