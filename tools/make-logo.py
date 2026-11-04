"""Emret Agency 8-bit piksel logosu — tek kaynaktan bütün çıktılar.

İşaret 16×16 piksellik bir karodur: koyu zemin, iri bir "E" ve yanında üç ışık
(yeşil = yerel, mavi = ücretsiz API, kırmızı = ücretli API — uygulamadaki motor
renkleri). Yazı 5×7 piksellik kendi yazı tipimizle çizilir; dış yazı tipi yok.

Üretilenler:
  build/icon.svg, build/icon.png (1024), build/icon.ico (16–256), build/icon.icns
  src/renderer/src/assets/brand/logo.png   başlık çubuğu (işaret + yazı)
  docs/img/logo.svg                        işaret (site, README, favicon)
  docs/img/logo-yazi.svg                   işaret + yazı (site başlığı, README)

Çalıştırma (depo kökünde):  python tools/make-logo.py   (Pillow gerekir)
"""
from pathlib import Path
from PIL import Image

KOK = Path(__file__).resolve().parent.parent

RENK = {
    'k': (26, 19, 32),      # koyu zemin  #1A1320
    'e': (245, 241, 230),   # harf        #F5F1E6
    'g': (47, 158, 106),    # yerel       #2F9E6A
    'b': (58, 111, 216),    # ücretsiz    #3A6FD8
    'r': (229, 72, 77),     # ücretli     #E5484D
}

# 16×16 işaret. '.' saydam, diğerleri RENK anahtarı.
ISARET = [
    '.kkkkkkkkkkkkkk.',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkeeeeeeeeeekkkk',
    'kkeeeeeeeeeekggk',
    'kkeeekkkkkkkkggk',
    'kkeeekkkkkkkkkkk',
    'kkeeeeeeeekkkkkk',
    'kkeeeeeeeekkkbbk',
    'kkeeekkkkkkkkbbk',
    'kkeeekkkkkkkkkkk',
    'kkeeeeeeeeeekkkk',
    'kkeeeeeeeeeekrrk',
    'kkkkkkkkkkkkkrrk',
    'kkkkkkkkkkkkkkkk',
    '.kkkkkkkkkkkkkk.',
]

HARF = {
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
    'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    ' ': ['...', '...', '...', '...', '...', '...', '...'],
}
YAZI = 'EMRET AGENCY'


def yazili_izgara() -> list[str]:
    """İşaret + yazı: 16 satırlık tek ızgara, koyu hap zemin üzerinde."""
    harfler = [HARF[c] for c in YAZI]
    yazi_gen = sum(len(h[0]) for h in harfler) + (len(harfler) - 1)
    gen = 16 + 3 + yazi_gen + 4
    satir = [['k'] * gen for _ in range(16)]
    for y in range(16):
        for x in range(16):
            satir[y][x] = ISARET[y][x]
    x0, y0 = 19, 5
    for h in harfler:
        for y, s in enumerate(h):
            for x, ch in enumerate(s):
                if ch == '#':
                    satir[y0 + y][x0 + x] = 'e'
        x0 += len(h[0]) + 1
    # Köşeler: piksel yuvarlatma
    for y, x in ((0, gen - 1), (15, gen - 1)):
        satir[y][x] = '.'
    return [''.join(s) for s in satir]


def png(izgara: list[str], olcek: int) -> Image.Image:
    h, w = len(izgara), len(izgara[0])
    im = Image.new('RGBA', (w * olcek, h * olcek), (0, 0, 0, 0))
    px = im.load()
    for y, s in enumerate(izgara):
        for x, ch in enumerate(s):
            if ch == '.':
                continue
            c = RENK[ch] + (255,)
            for dy in range(olcek):
                for dx in range(olcek):
                    px[x * olcek + dx, y * olcek + dy] = c
    return im


def svg(izgara: list[str], baslik: str) -> str:
    """Yatay tekrarları birleştirilmiş <rect>'ler: her tarayıcıda aynı, ölçeklenir."""
    h, w = len(izgara), len(izgara[0])
    parca = []
    for y, s in enumerate(izgara):
        x = 0
        while x < w:
            ch = s[x]
            if ch == '.':
                x += 1
                continue
            bas = x
            while x < w and s[x] == ch:
                x += 1
            r, g, b = RENK[ch]
            parca.append(f'<rect x="{bas}" y="{y}" width="{x - bas}" height="1" fill="#{r:02X}{g:02X}{b:02X}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w * 16}" height="{h * 16}" '
            f'shape-rendering="crispEdges" role="img"><title>{baslik}</title>' + ''.join(parca) + '</svg>\n')


def main() -> None:
    yazili = yazili_izgara()
    (KOK / 'docs/img').mkdir(parents=True, exist_ok=True)
    (KOK / 'docs/img/logo.svg').write_text(svg(ISARET, 'Emret Agency'), encoding='utf-8')
    (KOK / 'docs/img/logo-yazi.svg').write_text(svg(yazili, 'Emret Agency'), encoding='utf-8')
    (KOK / 'build/icon.svg').write_text(svg(ISARET, 'Emret Agency'), encoding='utf-8')
    png(ISARET, 64).save(KOK / 'build/icon.png')
    # ICO: her boyut en yakın komşu ile — 16 px'te birebir piksel.
    taban = png(ISARET, 16)  # 256
    taban.save(KOK / 'build/icon.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    png(ISARET, 64).save(KOK / 'build/icon.icns')
    png(yazili, 4).save(KOK / 'src/renderer/src/assets/brand/logo.png')
    print('ok')


if __name__ == '__main__':
    main()
