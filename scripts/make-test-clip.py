#!/usr/bin/env python3
"""Generate a 1080p30 H.264 test clip where each frame encodes its own index.

Top row: 16 squares of 96x96 px, black=0 white=1, most significant bit first.
The video page reads these back from the rendered texture to prove it got the
right frame. Also draws a moving circle and the frame number for humans.

Usage: python3 scripts/make-test-clip.py public/clips/coded-1080p30.mp4
"""
import subprocess, sys, math
from PIL import Image, ImageDraw, ImageFont

W, H, FPS, SECONDS = 1920, 1080, 30, 6
N = FPS * SECONDS
SQ, BITS = 96, 16
out = sys.argv[1] if len(sys.argv) > 1 else "coded-1080p30.mp4"

ff = subprocess.Popen(
    ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
     "-vf", "scale=out_color_matrix=bt709:out_range=tv",
     "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-g", str(FPS), "-bf", "2", "-pix_fmt", "yuv420p",
     "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart", out],
    stdin=subprocess.PIPE)

font = ImageFont.load_default(size=140)
for i in range(N):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(0, H, 6):  # vertical gradient, drifting over time
        t = (y / H + i / N) % 1.0
        d.rectangle([0, y, W, y + 6], fill=(int(40 + 120 * t), int(60 + 80 * (1 - t)), int(160 - 60 * t)))
    cx = int(W / 2 + 600 * math.sin(2 * math.pi * i / N * 2))
    cy = int(H / 2 + 250 * math.cos(2 * math.pi * i / N * 3))
    d.ellipse([cx - 160, cy - 160, cx + 160, cy + 160], fill=(250, 200, 40), outline=(20, 20, 20), width=8)
    d.text((60, 400), f"frame {i}", fill=(255, 255, 255), font=font)
    for b in range(BITS):
        bit = (i >> (BITS - 1 - b)) & 1
        v = 255 if bit else 0
        d.rectangle([b * SQ, 0, (b + 1) * SQ - 1, SQ - 1], fill=(v, v, v))
    ff.stdin.write(img.tobytes())
ff.stdin.close()
ff.wait()
print(f"wrote {out}: {N} frames")
