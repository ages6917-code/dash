/* ============================================================
   sw.js — 자폭(kill-switch) 서비스워커  (2026-07-15)

   [무슨 일이 있었나]
   과거에 캐싱하던 서비스워커가 /dash/ 스코프로 등록됐고, 그게 만든 CacheStorage(45.9MB)가
   사장님 노트북에 살아남아 **옛 페이지를 네트워크 대신 캐시에서 꺼내주고** 있었다.
   - "껐다 켜도 그대로"의 정체 = SW는 재부팅해도 살아있고 새로고침도 가로챈다.
   - 이 파일은 이미 패스스루(캐시 안 함)로 바뀌어 있었지만, **브라우저에 등록된 옛 SW가
     교체되기 전까지는 계속 옛 캐시를 서빙**한다 → 사장님이 오늘 세 번 헛수고하신 진짜 원인.
   - consult.html 한 곳에서만 register 했는데 스코프가 /dash/ 라서 위탁·현황판까지 가로챘다.

   [이 파일이 하는 일]
   브라우저가 이 새 sw.js를 받는 순간:
     1) 모든 CacheStorage 삭제
     2) 자기 자신을 unregister (이후 SW 없음 = 항상 네트워크 직행)
     3) 열려 있는 창을 강제 새로고침 → 즉시 최신 화면
   이후엔 서비스워커가 존재하지 않으므로 이 문제가 재발할 수 없다.

   [PWA는?]
   앱 설치(PWA)는 SW가 있어야 하지만, 지금은 "화면이 최신인가"가 비교할 수 없이 중요하다.
   나중에 PWA가 필요하면 캐시 전략(버전 태그·네트워크 우선)을 제대로 설계해 다시 넣는다.
   SW 없이도 대시보드는 전부 정상 동작한다(자동최신화 v3는 SW와 무관).
   ============================================================ */

self.addEventListener('install', function (e) {
  self.skipWaiting();          // 대기 없이 즉시 교체
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    try {
      var keys = await caches.keys();                                  // 1) 옛 캐시 전멸
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    } catch (err) { }
    try {
      await self.registration.unregister();                            // 2) 자기 자신 해제
    } catch (err) { }
    try {
      var cs = await self.clients.matchAll({ type: 'window' });        // 3) 열린 창 즉시 새로고침
      cs.forEach(function (c) { try { c.navigate(c.url); } catch (err) { } });
    } catch (err) { }
  })());
});

/* fetch 를 가로채지 않는다 — 항상 네트워크 */
