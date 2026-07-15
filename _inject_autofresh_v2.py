# -*- coding: utf-8 -*-
r"""
자동최신화 v2 주입 — 정적 대시보드 7종 (2026-07-15)

★왜: 기존 DASH_AUTOFRESH v1 은 페이지 로드 시 ETag를 '1회'만 확인하고 폴링이 없었다.
   사장님은 Chrome 앱창을 상시 켜두시는데, 그러면 새 배포를 영원히 못 받는다.
   → 오늘 하루 종일 "배포 완료"라고 보고했지만 사장님 화면은 아침 버전 그대로였다.
   (컨설팅 consult.html은 version.txt 방식이라 별도로 이미 수정함)

무엇: 60초마다 자기 자신을 HEAD 요청해 ETag 변화를 감지 → 바뀌었으면 자동 새로고침.
  · 입력 중(input/textarea 포커스)이면 리로드하지 않고 배너만 → 타이핑 보호
  · 기존 쿼리스트링 보존(?ns= 등)
  · v1 블록은 남겨둠(🔄최신화 버튼·배지는 그대로 쓴다). 폴링만 추가.

멱등: V2POLL 마커로 감싸고, 재실행 시 걷어내고 다시 넣는다.
실행: python -X utf8 _inject_autofresh_v2.py
"""
import os, re, glob, shutil, datetime

G = os.path.dirname(os.path.abspath(__file__))
M0, M1 = "<!--V2POLL-->", "<!--/V2POLL-->"
SKIP = {"status.html", "consult.html", "index.html", "home2026.html"}  # status=빌드스크립트 담당 / consult=version.txt 방식

JS = r"""
<script>
/* 자동최신화 폴링 v3 (2026-07-15) — v2의 치명적 버그 수정
   [v1 문제] 로드 시 1회만 확인 → 앱창 켜두면 새 배포를 영영 못 받음.
   [v2 문제] ETag를 sessionStorage와 비교했는데, '첫 방문이면 기준만 저장하고 return' 했다.
             → 이미 캐시된 옛 화면을 보고 있어도 그 상태를 정상으로 기준 삼아 영원히 안 바뀜.
             즉 "내가 지금 보는 게 최신인가"를 한 번도 묻지 않았다. 사장님 화면이 계속 옛날이던 이유.
   [v3 해결] 페이지가 자기 빌드(window.__DASHVER__)를 알고 있고, 서버의 dashver.txt와 직접 비교한다.
             첫 방문·캐시 무관하게 "지금 이 화면이 최신인가"를 즉시 판정. */
(function(){
  var busy=false, banner=null;
  function typing(){ var a=document.activeElement; return !!(a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.isContentEditable)); }
  function reload(v){
    try{ var u=new URL(location.href); u.searchParams.set('_v', v||Date.now()); location.replace(u.pathname+u.search); }
    catch(e){ location.replace(location.pathname+'?_v='+(v||Date.now())); }
  }
  function showBanner(v){
    if(banner) return;
    banner=document.createElement('div');
    banner.style.cssText='position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99999;background:#4f46e5;color:#fff;'
      +'padding:10px 16px;border-radius:11px;font-size:13px;font-weight:700;box-shadow:0 8px 24px rgba(79,70,229,.45);cursor:pointer;'
      +"font-family:'Malgun Gothic',sans-serif";
    banner.textContent='🆕 새 버전이 있습니다 — 눌러서 새로고침';
    banner.onclick=function(){ reload(v); };
    (document.body||document.documentElement).appendChild(banner);
  }
  function check(){
    if(busy||document.hidden) return; busy=true;
    fetch('dashver.txt',{cache:'no-store'}).then(function(r){ return r.ok?r.text():null; }).then(function(v){
      busy=false;
      if(!v) return; v=v.trim(); if(!v) return;
      var mine=window.__DASHVER__||'';
      if(!mine || v===mine) return;                 /* 최신이면 조용히 */
      var already=false;
      try{ already=(new URL(location.href)).searchParams.get('_v')===v; }catch(e){}
      if(already){ showBanner(v); return; }         /* 리로드했는데도 옛 빌드 = 캐시 → 배너로 */
      if(typing()){ showBanner(v); return; }        /* 입력 중이면 타이핑 보호 */
      reload(v);
    }).catch(function(){ busy=false; });
  }
  try{
    setTimeout(check, 2000);
    setInterval(check, 60000);
    document.addEventListener('visibilitychange', function(){ if(!document.hidden) check(); });
  }catch(e){}
})();
</script>
"""

ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = r"C:\TTAPP\_backup\autofresh_v2_%s" % ts
os.makedirs(bak, exist_ok=True)

done, skipped = [], []
for f in sorted(glob.glob(os.path.join(G, "*.html"))):
    name = os.path.basename(f)
    if name in SKIP:
        skipped.append(name); continue
    html = open(f, encoding="utf-8").read()
    shutil.copy2(f, bak)
    html = re.sub(re.escape(M0) + r".*?" + re.escape(M1), "", html, flags=re.S)   # 멱등
    i = html.rfind("</body>")
    if i < 0:
        # keyword.html처럼 </body>가 아예 없는 파일이 있다(스크립트로 끝남).
        # 앵커가 없다고 조용히 건너뛰면 그 대시보드만 영영 폴링이 안 붙는다 → 파일 끝에 덧붙인다.
        html = html.rstrip() + "\n" + M0 + JS + M1 + "\n"
        open(f, "w", encoding="utf-8").write(html)
        done.append(name + "(끝에 추가:</body>없음)"); continue
    html = html[:i] + M0 + JS + M1 + "\n" + html[i:]
    open(f, "w", encoding="utf-8").write(html)
    done.append(name)

print("백업:", bak)
print("폴링 주입:", done)
print("제외:", skipped)
