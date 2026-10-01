from pathlib import Path
from PIL import Image, ImageDraw

folder = Path(__file__).resolve().parent.parent / 'public' / 'icons'
folder.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 128):
    scale = 4
    im = Image.new('RGBA', (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    n = size * scale
    draw.rounded_rectangle((0, 0, n - 1, n - 1), radius=n * .22, fill='#203243')
    stroke = max(3, round(n * .07))
    for x, y in ((.2, .2), (.59, .2), (.2, .59)):
        draw.rectangle((n*x, n*y, n*(x+.21), n*(y+.21)), outline='#eff8f0', width=stroke)
    draw.rectangle((n*.59, n*.59, n*.8, n*.8), fill='#f1cb64')
    im.resize((size, size), Image.Resampling.LANCZOS).save(folder / f'{size}.png')
