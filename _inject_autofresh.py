# -*- coding: utf-8 -*-
"""대시보드 자동최신화 + 🔄버튼 일괄 주입 (멱등: 이미 있으면 skip)"""
import sys, io, re

SNIPPET = """<!-- DASH_AUTOFRESH v1 -->
<button id="dashRefreshBtn" title="최신화" onclick="dashForceRefresh()" style="position:fixed;left:12px;bottom:12px;z-index:99999;border:none;background:rgba(79,70,229,.92);color:#fff;border-radius:20px;padding:8px 13px;font-size:13px;font-weight:800;box-shadow:0 4px 12px rgba(0,0,0,.28);cursor:pointer;font-family:'Malgun Gothic',sans-serif">🔄 최신화</button>
<script>
function dashForceRefresh(){
  try{
    if('serviceWorker' in navigator){ navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});}); }
    if(window.caches && caches.keys){ caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});}); }
  }catch(e){}
  setTimeout(function(){ location.replace(location.pathname+'?_r='+Date.now()); }, 250);
}
(function(){
  try{
    fetch(location.pathname,{method:'HEAD',cache:'no-store'}).then(function(r){
      var tag=r.headers.get('ETag')||r.headers.get('Last-Modified'); if(!tag) return;
      var key='dashver:'+location.pathname, prev=localStorage.getItem(key);
      localStorage.setItem(key,tag);
      if(prev && prev!==tag && location.search.indexOf('_r=')===-1){
        location.replace(location.pathname+'?_r='+Date.now());
      }
    }).catch(function(){});
  }catch(e){}
})();
</script>
"""

def inject(path):
    try:
        with io.open(path, 'r', encoding='utf-8') as f:
            html = f.read()
    except Exception as e:
        return (path, 'ERR read: %s' % e)
    if 'DASH_AUTOFRESH' in html:
        return (path, 'skip (이미 있음)')
    # 마지막 </body> 앞에 삽입 (없으면 끝에 append)
    m = list(re.finditer(r'</body\s*>', html, re.IGNORECASE))
    if m:
        i = m[-1].start()
        html = html[:i] + SNIPPET + html[i:]
    else:
        html = html + '\n' + SNIPPET
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    return (path, 'OK 주입')

if __name__ == '__main__':
    for p in sys.argv[1:]:
        print('%-70s -> %s' % inject(p))
