# -*- coding: utf-8 -*-
r"""
위탁 대시보드 v2 패치 주입기 (재실행 안전 = 멱등)
- _wholesale_patch.css → </style> 앞
- _wholesale_patch.js  → </body> 앞
기존 2.9MB 원본(이미지 base64)은 그대로 두고 확장만 얹는다.
재실행 시 옛 패치 블록을 걷어내고 새로 넣으므로 중복 누적 없음.

실행: python -X utf8 _wholesale_apply.py
"""
import re, os, shutil, datetime

G = r"C:\Users\User\ttapp-tbot\_gh_dash"
W = os.path.join(G, "wholesale.html")
CSS = os.path.join(G, "_wholesale_patch.css")
JS = os.path.join(G, "_wholesale_patch.js")

M0, M1 = "<!--V2PATCH-->", "<!--/V2PATCH-->"

ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
bak_dir = r"C:\TTAPP\_backup\wholesale_v2_%s" % ts
os.makedirs(bak_dir, exist_ok=True)
shutil.copy2(W, bak_dir)
print("백업:", bak_dir)

html = open(W, encoding="utf-8").read()
css = open(CSS, encoding="utf-8").read()
js = open(JS, encoding="utf-8").read()

# 1) 기존 패치 제거(멱등)
before = len(html)
html = re.sub(re.escape(M0) + r".*?" + re.escape(M1), "", html, flags=re.S)
if len(html) != before:
    print("기존 v2 패치 제거됨")

# 2) CSS 주입 — 첫 </style> 앞
i = html.find("</style>")
if i < 0:
    raise SystemExit("</style> 못 찾음 — 중단")
html = html[:i] + f"\n{M0}\n{css}\n{M1}\n" + html[i:]

# 3) JS 주입 — </body> 앞
j = html.rfind("</body>")
if j < 0:
    raise SystemExit("</body> 못 찾음 — 중단")
html = html[:j] + f"\n{M0}\n<script>\n{js}\n</script>\n{M1}\n" + html[j:]

open(W, "w", encoding="utf-8").write(html)
print(f"주입 완료: {W} ({len(html):,} 바이트)")
print("  CSS", len(css), "바이트 / JS", len(js), "바이트")
