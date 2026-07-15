# -*- coding: utf-8 -*-
# 대시보드 정적 HTML에 '배포 버전 배지' 주입 (자동최신화 버튼 위에)
# 멱등: 이미 dashVerBadge 있으면 스킵. status.html은 빌드스크립트가 담당하므로 제외.
import os, glob, datetime

STAMP = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")  # 로컬(KST) 배포시각
BADGE = ('<div id="dashVerBadge" title="배포 버전 — 이 시각 이후가 최신"'
         ' style="position:fixed;left:12px;bottom:54px;z-index:99998;'
         'background:rgba(17,24,39,.80);color:#c7d2fe;border-radius:13px;padding:4px 10px;'
         'font-size:11px;font-weight:700;letter-spacing:.2px;box-shadow:0 3px 9px rgba(0,0,0,.22);'
         "font-family:'Malgun Gothic',sans-serif;pointer-events:none\">v" + STAMP + "</div>"
         '<script>try{if(window.__SYNC__)document.getElementById("dashVerBadge").textContent="v"+window.__SYNC__;}catch(e){}</script>')

BTN = '\U0001f504 최신화</button>'  # 🔄 최신화</button>
d = os.path.dirname(os.path.abspath(__file__))
done, skip, nobtn = [], [], []
for f in sorted(glob.glob(os.path.join(d, "*.html"))):
    name = os.path.basename(f)
    if name == "status.html":
        continue  # 빌드스크립트가 재주입 담당
    html = open(f, encoding="utf-8").read()
    if 'dashVerBadge' in html:
        skip.append(name); continue
    if BTN in html:
        html = html.replace(BTN, BTN + "\n" + BADGE, 1)
    else:
        low = html.lower(); i = low.rfind('</body>')
        if i == -1:
            nobtn.append(name); continue
        html = html[:i] + BADGE + html[i:]
        nobtn.append(name)
    open(f, "w", encoding="utf-8").write(html)
    done.append(name)

print("STAMP:", STAMP)
print("주입:", done)
print("스킵(이미있음):", skip)
print("버튼없어 body앞:", nobtn)
