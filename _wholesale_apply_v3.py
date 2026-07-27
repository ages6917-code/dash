# -*- coding: utf-8 -*-
r"""위탁 대시보드 v3 패치 주입기 (재실행 안전 = 멱등)
- _wholesale_v3.css → 첫 </style> 앞
- _wholesale_v3.js  → 마지막 </body> 앞 (v2 뒤에 실려야 override 가 먹는다)
원본(2.9MB, 이미지 base64)과 v2 패치는 건드리지 않는다.

실행: python _wholesale_apply_v3.py     (스크립트가 있는 폴더 = 저장소 폴더로 자동 인식)
"""
import re, os, shutil, datetime

G = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(G, "wholesale.html")
CSS = os.path.join(G, "_wholesale_v3.css")
JS = os.path.join(G, "_wholesale_v3.js")
M0, M1 = "<!--V3PATCH-->", "<!--/V3PATCH-->"

ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = os.path.join(G, "_backup_v3")
os.makedirs(bak, exist_ok=True)
shutil.copy2(W, os.path.join(bak, "wholesale_%s.html" % ts))

html = open(W, encoding="utf-8").read()
css = open(CSS, encoding="utf-8").read()
js = open(JS, encoding="utf-8").read()

before = len(html)
html = re.sub(re.escape(M0) + r".*?" + re.escape(M1), "", html, flags=re.S)
if len(html) != before:
    print("기존 v3 패치 제거됨(멱등)")

i = html.find("</style>")
if i < 0:
    raise SystemExit("</style> 못 찾음 — 중단")
html = html[:i] + "\n%s\n%s\n%s\n" % (M0, css, M1) + html[i:]

j = html.rfind("</body>")
if j < 0:
    raise SystemExit("</body> 못 찾음 — 중단")
html = html[:j] + "\n%s\n<script>\n%s\n</script>\n%s\n" % (M0, js, M1) + html[j:]

open(W, "w", encoding="utf-8").write(html)
print("v3 주입 완료: %s (%d 바이트) / 백업 %s" % (W, len(html.encode("utf-8")), bak))
