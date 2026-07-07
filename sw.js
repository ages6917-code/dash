// 최소 서비스워커 — PWA 설치조건 충족용. 네트워크 패스스루(캐시 안함=항상 최신).
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(e){ /* 기본 네트워크 fetch = 캐시 없이 항상 최신 */ });
