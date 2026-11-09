# Generates the neutral home-screen icons (a plain "L" on slate).
# Run once: python3 scripts/icons.py
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BG = (94, 104, 118)
FG = (246, 246, 248)


def make(size, name, scale=0.56):
    img = Image.new('RGB', (size, size), BG)
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, int(size * scale))
    box = d.textbbox((0, 0), 'L', font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), 'L', font=font, fill=FG)
    img.save(os.path.join(OUT, name), optimize=True)


make(192, 'icon-192.png')
make(512, 'icon-512.png')
make(512, 'icon-maskable-512.png', scale=0.42)
make(180, 'apple-touch-icon.png')
