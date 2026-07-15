# -*- coding: utf-8 -*-
# 대시보드 정적 HTML에 '배포 버전 배지' 주입 (자동최신화 버튼 위에)
# status.html은 빌드스크립트가 담당하므로 제외.
#
# ★2026-07-15 버그수정 — 종전에는 'dashVerBadge 있으면 스킵'이라 배지 날짜가 최초 주입일에
#   영원히 굳었다(8종 전부 07-14에 멈춤). 배지의 존재 목적이 "이 시각 이후가 최신"인데
#   배포해도 날짜가 안 바뀌면 최신 판별이 불가능 = 기능이 거짓말을 하고 있었다.
#   → 이제 배지가 이미 있으면 '날짜만 현재 배포시각으로 갱신'한다.
import os, glob, datetime, re

STAMP = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")  # 로컬(KST) 배포시각
# ★2026-07-15 — 페이지가 '자기 빌드'를 알아야 자동최신화(v3)가 "지금 보는 게 최신인가"를 판정할 수 있다.
#   종전엔 배지에 글자로만 있어서 코드가 못 읽었다 → window.__DASHVER__ 로 심는다.
VERVAR = '<script>window.__DASHVER__="' + STAMP + '";</script>'
BADGE = (VERVAR + '<div id="dashVerBadge" title="배포 버전 — 이 시각 이후가 최신"'
         ' style="position:fixed;left:12px;bottom:54px;z-index:99998;'
         'background:rgba(17,24,39,.80);color:#c7d2fe;border-radius:13px;padding:4px 10px;'
         'font-size:11px;font-weight:700;letter-spacing:.2px;box-shadow:0 3px 9px rgba(0,0,0,.22);'
         "font-family:'Malgun Gothic',sans-serif;pointer-events:none\">v" + STAMP + "</div>"
         '<script>try{if(window.__SYNC__)document.getElementById("dashVerBadge").textContent="v"+window.__SYNC__;}catch(e){}</script>')

BTN = '\U0001f504 최신화</button>'  # 🔄 최신화</button>
d = os.path.dirname(os.path.abspath(__file__))
done, updated, nobtn = [], [], []
# 이미 박힌 배지의 날짜만 갈아끼우는 패턴 (…pointer-events:none">v2026-07-14 16:26</div>)
RE_STAMP = re.compile(r'(id="dashVerBadge".*?pointer-events:none">)v[\d\-: ]+(</div>)', re.S)

for f in sorted(glob.glob(os.path.join(d, "*.html"))):
    name = os.path.basename(f)
    if name == "status.html":
        continue  # 빌드스크립트가 재주입 담당
    html = open(f, encoding="utf-8").read()
    if 'dashVerBadge' in html:
        new, n = RE_STAMP.subn(r"\g<1>v" + STAMP + r"\g<2>", html, count=1)
        if n:
            # __DASHVER__ 도 같이 갱신(없으면 배지 앞에 새로 삽입) — 자동최신화 v3가 이 값을 본다
            # ★'window.__DASHVER__' 로만 찾으면 폴링코드의 '참조'(window.__DASHVER__||'')까지 걸려서
            #   '이미 있다'고 오판하고 삽입을 건너뛴다 → 반드시 '할당문'으로 판정할 것.
            if re.search(r'window\.__DASHVER__\s*=', new):
                new = re.sub(r'window\.__DASHVER__\s*=\s*"[^"]*"',
                             'window.__DASHVER__="' + STAMP + '"', new, count=1)
            else:
                new = new.replace('<div id="dashVerBadge"', VERVAR + '<div id="dashVerBadge"', 1)
            open(f, "w", encoding="utf-8").write(new)
            updated.append(name)
        else:
            nobtn.append(name + "(배지패턴 불일치 — 수동확인)")
        continue
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

# ★서버 기준 버전 파일 — 각 페이지가 이걸 60초마다 읽어 자기 __DASHVER__와 비교한다.
#   (ETag 방식은 "첫 방문이면 현 상태를 정상으로 기준삼는" 함정이 있어 폐기)
open(os.path.join(d, "dashver.txt"), "w", encoding="utf-8").write(STAMP)

print("STAMP:", STAMP)
print("신규주입:", done)
print("날짜갱신:", updated)
print("확인필요:", nobtn)
print("dashver.txt:", STAMP)
