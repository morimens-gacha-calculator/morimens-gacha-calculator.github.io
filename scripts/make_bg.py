# Procedural background: dark navy nebula, stars, and a faint summoning circle.
import numpy as np, math
from PIL import Image, ImageDraw, ImageFilter
W, H = 2400, 1350
rng = np.random.default_rng(7)
y, x = np.mgrid[0:H, 0:W].astype(np.float32)

img = np.zeros((H, W, 3), np.float32)
img[:] = (30, 32, 52)                                   # base navy
def blob(cx, cy, r, color, k=1.0):
    d = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r)
    img[:] += np.exp(-d)[..., None] * np.array(color, np.float32) * k
blob(0.18 * W, 0.20 * H, 520, (70, 55, 140))           # violet, top-left
blob(0.82 * W, 0.15 * H, 600, (35, 85, 150))           # blue, top-right
blob(0.55 * W, 0.55 * H, 700, (60, 40, 110), 0.7)      # deep violet, centre
blob(0.95 * W, 0.75 * H, 420, (110, 50, 120), 0.6)     # magenta, right
blob(0.05 * W, 0.85 * H, 450, (30, 70, 120), 0.6)      # blue, bottom-left
# soft cloudy texture
noise = rng.random((H // 30 + 2, W // 30 + 2)).astype(np.float32)
n = np.array(Image.fromarray((noise * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(40)), np.float32) / 255
img *= (0.8 + 0.4 * n)[..., None]

base = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))

# stars on their own layer, with a little glow
stars = Image.new("RGB", (W, H), (0, 0, 0))
d = ImageDraw.Draw(stars)
for _ in range(1400):
    sx, sy = rng.random() * W, rng.random() * H
    b = int(120 + 135 * rng.random() ** 3)
    r = 0.6 + 1.4 * rng.random() ** 6
    tint = (b, b, min(255, b + 25))
    d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=tint)
glow = stars.filter(ImageFilter.GaussianBlur(3))
base = Image.fromarray(np.clip(np.array(base, np.float32) + np.array(stars, np.float32) * 0.9 + np.array(glow, np.float32) * 1.2, 0, 255).astype(np.uint8))

# faint summoning circle, top-right
circle = Image.new("L", (W, H), 0)
c = ImageDraw.Draw(circle)
cx, cy = 0.83 * W, 0.34 * H
for rad, wdt in [(430, 3), (395, 2), (300, 2), (180, 2), (90, 2)]:
    c.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=255, width=wdt)
for i in range(12):                                     # runes ring: short ticks
    a = i * math.pi / 6
    c.line([cx + 395 * math.cos(a), cy + 395 * math.sin(a), cx + 430 * math.cos(a), cy + 430 * math.sin(a)], fill=255, width=3)
for k in range(2):                                      # two interlocking triangles (a hexagram)
    pts = [(cx + 300 * math.cos(a), cy + 300 * math.sin(a)) for a in [math.pi / 2 + k * math.pi + j * 2 * math.pi / 3 for j in range(3)]]
    c.line(pts + [pts[0]], fill=255, width=2)
for i in range(5):                                      # five-pointed star inside
    a1, a2 = -math.pi / 2 + i * 2 * math.pi / 5, -math.pi / 2 + (i + 2) * 2 * math.pi / 5
    c.line([cx + 180 * math.cos(a1), cy + 180 * math.sin(a1), cx + 180 * math.cos(a2), cy + 180 * math.sin(a2)], fill=255, width=2)
circle = circle.filter(ImageFilter.GaussianBlur(1.2))
glow_c = circle.filter(ImageFilter.GaussianBlur(10))
arr = np.array(base, np.float32)
col = np.array((190, 175, 255), np.float32)
arr += (np.array(circle, np.float32) / 255 * 0.20 + np.array(glow_c, np.float32) / 255 * 0.08)[..., None] * col
Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save("src/assets/background.webp", "WEBP", quality=78, method=6)
small = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).resize((1200, 675), Image.LANCZOS)
small.save("src/assets/background-small.webp", "WEBP", quality=75, method=6)

