# -*- coding: utf-8 -*-
"""
_make_pwa.py — 아이콘 없는 대시보드 7개에 앱 아이콘 + PWA(독립창) 부여
  1) pwa/<key>/icon180·192·512.png 생성 (풀블리드 그라데이션 + 흰 한글 글자)
  2) pwa/<key>/manifest.json 생성 (display standalone, /dash 절대경로)
  3) 각 HTML <head>에 manifest + apple-touch-icon + meta 주입 (idempotent, <!--PWA--> 마커)
GitHub Pages base = /dash/
"""
import os, json
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = "/dash"

FONTS = [r"C:\Windows\Fonts\malgunbd.ttf", r"C:\Windows\Fonts\malgun.ttf"]
def font(sz):
    for f in FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()

def hexrgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

APPS = [
    # key, file, title, short, char, c1(top), c2(bottom)
    ("hub",       "index.html",      "대시보드 허브", "허브",   "허", "#4f46e5", "#7c3aed"),
    ("wholesale", "wholesale.html",  "위탁 거래처",   "위탁",   "위", "#0e9aa4", "#22b8c4"),
    ("temu",      "temu.html",       "테무 대시보드", "테무",   "테", "#f97316", "#fb923c"),
    ("hustle",    "hustle.html",     "부업 발굴",     "부업",   "부", "#6d5ef0", "#a855f7"),
    ("keyword",   "keyword.html",    "키워드 발굴",   "키워드", "키", "#16a34a", "#4ade80"),
    ("home",      "home_index.html", "사업 홈",       "사업홈", "홈", "#2563eb", "#38bdf8"),
    ("hotdeal",   "hotdeal.html",    "핫딜연합",      "핫딜",   "핫", "#dc2626", "#f87171"),
]

def make_icon(size, char, c1, c2):
    a, b = hexrgb(c1), hexrgb(c2)
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        r = int(a[0] + (b[0]-a[0])*t); g = int(a[1]+(b[1]-a[1])*t); bl = int(a[2]+(b[2]-a[2])*t)
        for x in range(size):
            px[x, y] = (r, g, bl)
    d = ImageDraw.Draw(img)
    fs = int(size * 0.52)
    fnt = font(fs)
    bb = d.textbbox((0, 0), char, font=fnt)
    w, h = bb[2]-bb[0], bb[3]-bb[1]
    x = (size - w)/2 - bb[0]; y = (size - h)/2 - bb[1]
    d.text((x+size*0.012, y+size*0.012), char, font=fnt, fill=(0, 0, 0, 60))  # 살짝 그림자
    d.text((x, y), char, font=fnt, fill=(255, 255, 255))
    return img

PWA_TAGS = ('<!--PWA-->'
    '<link rel="manifest" href="{b}/pwa/{k}/manifest.json">'
    '<meta name="theme-color" content="{c}">'
    '<meta name="mobile-web-app-capable" content="yes">'
    '<meta name="apple-mobile-web-app-capable" content="yes">'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
    '<meta name="apple-mobile-web-app-title" content="{s}">'
    '<link rel="apple-touch-icon" href="{b}/pwa/{k}/icon180.png">')

done = []
for key, fname, title, short, char, c1, c2 in APPS:
    outdir = os.path.join(ROOT, "pwa", key)
    os.makedirs(outdir, exist_ok=True)
    # 1) icons
    big = make_icon(512, char, c1, c2)
    big.save(os.path.join(outdir, "icon512.png"))
    big.resize((192, 192), Image.LANCZOS).save(os.path.join(outdir, "icon192.png"))
    big.resize((180, 180), Image.LANCZOS).save(os.path.join(outdir, "icon180.png"))
    # 2) manifest
    man = {
        "name": title, "short_name": short,
        "start_url": BASE + "/" + fname, "scope": BASE + "/" + fname, "id": BASE + "/" + fname,
        "display": "standalone", "background_color": c1, "theme_color": c1,
        "icons": [
            {"src": BASE+"/pwa/"+key+"/icon192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": BASE+"/pwa/"+key+"/icon512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
    }
    open(os.path.join(outdir, "manifest.json"), "w", encoding="utf-8").write(json.dumps(man, ensure_ascii=False))
    # 3) inject into HTML head
    fp = os.path.join(ROOT, fname)
    if not os.path.exists(fp):
        print("SKIP(no file):", fname); continue
    html = open(fp, encoding="utf-8").read()
    if "<!--PWA-->" in html:
        print("ALREADY:", fname); done.append(key); continue
    tags = PWA_TAGS.format(b=BASE, k=key, c=c1, s=short)
    if "</title>" in html:
        html = html.replace("</title>", "</title>" + tags, 1)
    elif "<head>" in html:
        html = html.replace("<head>", "<head>" + tags, 1)
    else:
        html = tags + html
    open(fp, "w", encoding="utf-8").write(html)
    print("OK:", fname, "->", key)
    done.append(key)

print("DONE apps:", done)
