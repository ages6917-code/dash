/* ============================================================
   위탁 대시보드 v2 패치 (2026-07-15, 사장님 요구 5종)
   1) 거래처 주문 양식 드래그앤드롭 업로드
   2) 거래처별 택배 마감시간 — 첫 화면 카드에 표시 + 편집
   3) [주문 수집] → 작업큐 → 노트북 수집 → 양식작성 → [다운로드]
   4) 제품·마진 탭 (판매가/마진 한눈에)
   5) 데스크톱·노트북·모바일 동기화 (RTDB 단일 소스)

   설계: 기존 코드를 건드리지 않고 override 방식으로 얹는다(2.9MB 원본 안전).
   데이터: RTDB shared/wholesale/{vendors,products} 가 단일 소스.
           로드 실패 시 기존 하드코딩 window.DASH 로 자동 폴백(화면 안 죽게).
   ============================================================ */
(function () {
  'use strict';
  if (!window.firebase || !window.wdb) { console.log('[v2] firebase 없음 — 패치 중단'); return; }
  var wdb = window.wdb;
  var R = 'shared/wholesale/';

  /* ---------- 공통 ---------- */
  function won(n) { return n == null ? '–' : Number(n).toLocaleString() + '원'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }
  // 마진 = 판매가의 90%(플랫폼 수수료 10% 차감) - (매입가+배송비). 기존 대시보드 공식 유지.
  function calcOf(buy, ship) { if (buy == null) return null; var c = buy + (ship || 0); return { bep: Math.ceil(c / 0.9 / 100) * 100, sell: Math.ceil(c / 0.65 / 100) * 100 }; }
  function recOf(p) { if (p.sell != null) return p.sell; var c = calcOf(p.buy, p.ship); return c ? c.sell : null; }
  function mgOf(p) { if (p.buy == null) return null; var r = recOf(p); if (r == null) return null; return Math.round((r * 0.9 - (p.buy + (p.ship || 0))) / r * 100); }
  window.__v2 = { won: won, recOf: recOf, mgOf: mgOf };

  /* ---------- 1) RTDB 단일 소스 로드 (요구 5) ---------- */
  var V2 = { vendors: [], products: [], forms: {}, jobs: {}, ready: false };
  window.V2 = V2;

  function rebuildDASH() {
    if (!V2.vendors.length) return false;
    var byV = {};
    V2.products.forEach(function (p) { (byV[p.vendorId] = byV[p.vendorId] || []).push(p); });
    var sup = V2.vendors.map(function (v) {
      var o = JSON.parse(JSON.stringify(v));
      o.products = byV[v.id] || [];
      return o;
    });
    window.DASH.suppliers = sup;
    window.D = window.DASH;               // 기존 코드가 참조하는 D 갱신
    window.DASH.updated = V2.dataUpdated || window.DASH.updated;
    V2.ready = true;
    return true;
  }

  function boot() {
    var pend = 2;
    function done() { if (--pend <= 0) { rebuildDASH(); safeRender(); } }
    wdb.ref(R + 'vendors').on('value', function (s) { V2.vendors = s.val() || []; if (V2.ready) { rebuildDASH(); safeRender(); reopenIfOpen(); } else done(); });
    wdb.ref(R + 'products').on('value', function (s) { V2.products = s.val() || []; if (V2.ready) { rebuildDASH(); safeRender(); } else done(); });
    wdb.ref(R + 'forms').on('value', function (s) { V2.forms = s.val() || {}; if (V2.ready) { safeRender(); reopenIfOpen(); } });
    wdb.ref(R + 'jobs').on('value', function (s) { V2.jobs = s.val() || {}; renderJobBar(); });
    wdb.ref(R + '_trash').on('value', function (s) { V2.trash = s.val() || {}; renderTrashChip(); });
    wdb.ref(R + 'dataUpdated').on('value', function (s) { V2.dataUpdated = s.val(); });
    // RTDB가 비어있거나 막혀도 5초 뒤엔 기존 하드코딩으로 화면을 띄운다(백지 방지)
    setTimeout(function () { if (!V2.ready) { console.log('[v2] RTDB 미응답 — 내장 데이터로 폴백'); safeRender(); } }, 5000);
  }

  // ★RTDB 로드는 화면이 다 그려진 뒤에 도착한다. 그래서 헤더(거래처 수·품목 수·기준일)가
  //   옛 하드코딩 값(4곳/40품목/06-27)에 멈춰 있었다 → 데이터 도착할 때마다 헤더도 다시 그린다.
  function safeRender() {
    try { if (typeof window.setHeader === 'function') window.setHeader(); } catch (e) { console.log('[v2] setHeader 실패', e); }
    try { if (typeof window.render === 'function') window.render(); } catch (e) { console.log('[v2] render 실패', e); }
    // setHeader가 chips를 통째로 다시 그리므로 휴지통 칩은 그 뒤에 다시 붙여야 한다.
    try { renderTrashChip(); } catch (e) { }
  }

  /* ---------- 2) 택배 마감시간 (요구 2) ---------- */
  // 확정값은 RTDB vendors[i].shipDeadline. 비어있으면 note에서 뽑은 후보를 '추정'으로 표시.
  function deadlineOf(s) {
    var fix = (s.shipDeadline || '').trim();
    if (fix) return { txt: fix, guess: false };
    var g = (s.shipDeadlineGuess || '').trim();
    if (g) return { txt: g, guess: true };
    return { txt: '', guess: false };
  }
  function deadlineBadge(s) {
    var d = deadlineOf(s);
    if (!d.txt) return '<span class="dl dl-none">🕐 마감 미상</span>';
    return '<span class="dl ' + (d.guess ? 'dl-guess' : 'dl-ok') + '">🕐 ' + esc(d.txt) + (d.guess ? ' <i>추정</i>' : '') + '</span>';
  }
  window.saveDeadline = function (vid, val) {
    var i = V2.vendors.findIndex(function (v) { return v.id === vid; });
    if (i < 0) return;
    wdb.ref(R + 'vendors/' + i + '/shipDeadline').set(val || '');
    toast(val ? '마감시간 저장: ' + val : '마감시간 지움');
  };

  /* ---------- 3) 주문 양식 업로드 (요구 1) ---------- */
  window.uploadForm = function (vid, file) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast('⚠️ 4MB 이하만 (현재 ' + Math.round(file.size / 1024 / 1024) + 'MB)'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      wdb.ref(R + 'forms/' + vid).set({
        name: file.name, size: file.size, type: file.type || '',
        data: fr.result, at: new Date().toISOString().slice(0, 16).replace('T', ' ')
      }, function (err) { toast(err ? '❌ 업로드 실패: ' + err : '✅ 양식 업로드: ' + file.name); });
    };
    fr.readAsDataURL(file);
  };
  window.deleteForm = function (vid) {
    if (!confirm('이 거래처 주문 양식을 지울까요?')) return;
    wdb.ref(R + 'forms/' + vid).remove(); toast('양식 삭제됨');
  };
  window.downloadForm = function (vid) {
    var f = V2.forms[vid]; if (!f) return;
    var a = document.createElement('a'); a.href = f.data; a.download = f.name; a.click();
  };

  /* ---------- 4) 주문 수집 작업큐 (요구 3) ---------- */
  // 폰은 테무를 직접 못 긁는다(로그인 크롬은 노트북에만 있음).
  // → 여기서 '작업 티켓'만 만들고, 노트북 워커가 처리해서 결과를 되돌려준다.
  window.requestCollect = function (vid, vname) {
    if (!V2.forms[vid]) { if (!confirm('이 거래처의 주문 양식이 아직 없습니다.\n양식 없이 기본(공통) 형식으로 수집할까요?')) return; }
    var id = 'job_' + Date.now();
    wdb.ref(R + 'jobs/' + id).set({
      vendorId: vid, vendorName: vname, status: 'queued',
      requestedAt: new Date().toISOString(), requestedFrom: navigator.userAgent.slice(0, 40),
      hasForm: !!V2.forms[vid]
    }, function (err) { toast(err ? '❌ 요청 실패' : '📤 주문수집 요청됨 — 노트북이 처리합니다'); });
  };
  window.cancelJob = function (id) { wdb.ref(R + 'jobs/' + id).remove(); toast('요청 취소'); };
  window.downloadJob = function (id) {
    var j = V2.jobs[id]; if (!j || !j.file) return;
    var a = document.createElement('a'); a.href = j.file; a.download = j.fileName || (j.vendorName + '_주문서.xlsx'); a.click();
  };

  // 진행중 작업 표시줄 (첫 화면 상단)
  function renderJobBar() {
    var host = document.getElementById('v2jobbar');
    if (!host) return;
    var ids = Object.keys(V2.jobs || {});
    if (!ids.length) { host.innerHTML = ''; return; }
    var ST = { queued: ['⏳', '대기중 — 노트북 확인 대기'], running: ['⚙️', '수집중…'], done: ['✅', '완료'], error: ['❌', '실패'] };
    host.innerHTML = ids.sort().reverse().slice(0, 6).map(function (id) {
      var j = V2.jobs[id], st = ST[j.status] || ['•', j.status];
      var btn = '';
      if (j.status === 'done' && j.file) btn = '<button class="jb jb-dl" onclick="downloadJob(\'' + id + '\')">⬇ 다운로드</button>';
      else if (j.status === 'error') btn = '<span class="jerr">' + esc(j.error || '사유 미기록') + '</span>';
      else btn = '<button class="jb jb-x" onclick="cancelJob(\'' + id + '\')">취소</button>';
      return '<div class="jrow"><b>' + st[0] + ' ' + esc(j.vendorName) + '</b><span>' + st[1] + (j.count != null ? ' · ' + j.count + '건' : '') + '</span>' + btn + '</div>';
    }).join('');
  }
  window.renderJobBar = renderJobBar;

  /* ---------- 4-2) 거래처 삭제 + 휴지통 (2026-07-15 추가) ---------- */
  // 삭제는 되돌릴 수 없는 작업이다. 그래서 지우기 전에 통째로 휴지통에 스냅샷을 뜬다.
  //  - 거래처 1건 + 그 거래처 제품 전부 + 주문양식까지 한 덩어리로 보관 → 복구 시 원상복구.
  //  - vendors/products 는 '배열'이라 부분 삭제가 인덱스를 밀어버린다 → 항상 전체 재작성(PUT).
  window.deleteVendor = function (vid) {
    var v = V2.vendors.find(function (x) { return x.id === vid; });
    if (!v) return;
    var mine = V2.products.filter(function (p) { return p.vendorId === vid; });
    if (!confirm('“' + v.name + '” 거래처를 삭제할까요?\n\n· 등록 제품 ' + mine.length + '개도 함께 사라집니다.\n· 휴지통에 보관되므로 되살릴 수 있습니다.')) return;

    var snap = {
      vendor: v, products: mine, form: V2.forms[vid] || null,
      deletedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      name: v.name, count: mine.length
    };
    var tid = 'tr_' + Date.now();
    wdb.ref(R + '_trash/' + tid).set(snap, function (err) {
      if (err) { toast('❌ 휴지통 저장 실패 — 삭제 중단'); return; }   // 백업 실패 시 삭제 안 함
      var nv = V2.vendors.filter(function (x) { return x.id !== vid; });
      var np = V2.products.filter(function (p) { return p.vendorId !== vid; });
      wdb.ref(R + 'vendors').set(nv);
      wdb.ref(R + 'products').set(np);
      if (V2.forms[vid]) wdb.ref(R + 'forms/' + vid).remove();
      try { window.closeModal(); } catch (e) { }
      toast('🗑 “' + v.name + '” 삭제됨 — 휴지통에서 복구 가능');
    });
  };

  window.restoreVendor = function (tid) {
    var t = (V2.trash || {})[tid]; if (!t) return;
    if (V2.vendors.some(function (x) { return x.id === t.vendor.id; })) { toast('⚠️ 같은 id 거래처가 이미 있습니다'); return; }
    var nv = V2.vendors.concat([t.vendor]);
    var np = V2.products.concat(t.products || []);
    wdb.ref(R + 'vendors').set(nv);
    wdb.ref(R + 'products').set(np);
    if (t.form) wdb.ref(R + 'forms/' + t.vendor.id).set(t.form);
    wdb.ref(R + '_trash/' + tid).remove();
    toast('♻️ “' + t.name + '” 복구됨');
    setTimeout(openTrash, 400);
  };

  window.purgeTrash = function (tid) {
    var t = (V2.trash || {})[tid]; if (!t) return;
    if (!confirm('“' + t.name + '”을(를) 휴지통에서 완전히 지울까요?\n이건 되돌릴 수 없습니다.')) return;
    wdb.ref(R + '_trash/' + tid).remove();
    toast('영구 삭제됨'); setTimeout(openTrash, 400);
  };

  window.openTrash = function () {
    var ids = Object.keys(V2.trash || {});
    var modal = document.getElementById('modal'), ov = document.getElementById('overlay');
    if (!modal || !ov) return;
    _openIdx = null;
    modal.innerHTML = '<div class="mhead"><div class="avatar">🗑</div><div><h2>휴지통</h2>' +
      '<div class="vcat">삭제한 거래처를 되살릴 수 있습니다</div></div>' +
      '<button class="close" onclick="closeModal()">✕</button></div>' +
      (!ids.length ? '<div class="v2empty">비어 있습니다.</div>' :
        '<div class="trlist">' + ids.sort().reverse().map(function (id) {
          var t = V2.trash[id];
          return '<div class="trrow"><div><b>' + (t.vendor.emoji || '📦') + ' ' + esc(t.name) + '</b>' +
            '<div class="sub">제품 ' + (t.count || 0) + '개 · 삭제 ' + esc(t.deletedAt) + '</div></div>' +
            '<button class="v2btn sm" onclick="restoreVendor(\'' + id + '\')">♻️ 복구</button>' +
            '<button class="v2btn sm ghost" onclick="purgeTrash(\'' + id + '\')">영구삭제</button></div>';
        }).join('') + '</div>');
    ov.classList.add('on');
  };

  /* ---------- 4-3) 제품 편집 (2026-07-15 사장님 요청) ----------
     "각 제품 클릭했을 때 마진률·금액 기타 등 기존처럼 수정 가능하게"
     · 제품 카드 클릭 → 편집창. 매입가·배송비·판매가·시장가·메모·스펙 수정.
     · 마진은 입력값이 아니라 **계산 결과**다(판매가×0.9 − 매입가 − 배송비) → 입력하는 동안 실시간 미리보기.
     · 저장 = RTDB → 데탑·노트북·폰 즉시 반영.
     ※ products 는 배열이라 pid 로 인덱스를 찾아 그 자리만 갱신한다(전체 덮어쓰기 금지 = 동시수정 충돌 방지). */
  function _pidx(pid) { return V2.products.findIndex(function (p) { return p.pid === pid; }); }

  window.editProduct = function (pid) {
    var i = _pidx(pid); if (i < 0) return toast('제품을 찾을 수 없습니다');
    var p = V2.products[i];
    var v = V2.vendors.find(function (x) { return x.id === p.vendorId; }) || {};
    var modal = document.getElementById('modal'), ov = document.getElementById('overlay');
    if (!modal || !ov) return;
    _openIdx = null;
    modal.innerHTML =
      '<div class="mhead"><div class="avatar">' + (p.emoji || '📦') + '</div>'
      + '<div><h2 style="font-size:19px">' + esc(p.name) + '</h2>'
      + '<div class="vcat">' + esc(v.name || '') + (p.g ? ' · ' + esc(p.g) : '') + '</div></div>'
      + '<button class="close" onclick="closeModal()">✕</button></div>'
      + '<div class="pedit">'
      + '  <div class="pe-row"><label>제품명</label><input id="pe_name" value="' + esc(p.name || '') + '"></div>'
      + '  <div class="pe-row"><label>규격</label><input id="pe_spec" value="' + esc(p.spec || '') + '" placeholder="예) 1kg / 20개입 박스"></div>'
      + '  <div class="pe-2">'
      + '    <div class="pe-row"><label>매입가 <i>원</i></label><input id="pe_buy" type="number" inputmode="numeric" value="' + (p.buy != null ? p.buy : '') + '" oninput="peCalc()" placeholder="미입력"></div>'
      + '    <div class="pe-row"><label>배송비 <i>원</i></label><input id="pe_ship" type="number" inputmode="numeric" value="' + (p.ship || 0) + '" oninput="peCalc()"></div>'
      + '  </div>'
      + '  <div class="pe-2">'
      + '    <div class="pe-row"><label>판매가 <i>원 · 비우면 자동산출</i></label>'
      + '      <input id="pe_sell" type="number" inputmode="numeric" value="' + (p.sell != null ? p.sell : '') + '" oninput="peCalc(\'sell\')" placeholder="자동"></div>'
      + '    <div class="pe-row"><label>마진률 <i>% · 여기 넣으면 판매가 역산</i></label>'
      + '      <input id="pe_mg" type="number" inputmode="numeric" oninput="peCalc(\'mg\')" placeholder="예) 40"></div>'
      + '  </div>'
      + '  <div class="pe-calc" id="pe_calc"></div>'
      + '  <div class="pe-row"><label>시장 시세 <i>참고용 메모</i></label><input id="pe_mkt" value="' + esc(p.mkt || '') + '" placeholder="예) 네이버/쿠팡 20개입 23,900~30,900"></div>'
      + '  <div class="pe-row"><label>메모</label><textarea id="pe_note" rows="2" placeholder="특이사항·검증 필요 등">' + esc(p.note || '') + '</textarea></div>'
      + '  <div class="pe-btns">'
      + '    <button class="v2btn" style="flex:1" onclick="saveProduct(\'' + pid + '\')">💾 저장</button>'
      + '    <button class="v2btn ghost" onclick="closeModal()">취소</button>'
      + '    <button class="v2btn ghost" style="color:#dc2626" onclick="delProduct(\'' + pid + '\')">🗑 제품 삭제</button>'
      + '  </div>'
      + '  <div class="v2sub" style="text-align:center;margin-top:8px">☁️ 저장하면 데탑·노트북·폰에 즉시 반영됩니다</div>'
      + '</div>';
    ov.classList.add('on');
    peCalc('init');   /* 열자마자 현재 마진률을 마진칸에 채워 보여준다 */
  };

  /* 판매가 ↔ 마진률 양방향 (2026-07-15 사장님 요청)
       판매가 입력 → 마진률 자동 표시
       마진률 입력 → 판매가 역산      ← "40% 남기려면 얼마 받아야 하나"를 바로 답해준다
     수식: 마진 = (판매가×0.9 − 원가) / 판매가        (0.9 = 플랫폼 수수료 10% 차감)
           역산  판매가 = 원가 / (0.9 − 마진)
     ※ 역산 판매가는 100원 단위로 올림 → 그 값으로 마진을 '다시 계산'해 표시한다.
        (올림 때문에 입력한 40%와 실제 40.3%가 다를 수 있는데, 화면엔 진짜 값을 보여줘야 한다)
     ※ src = 방금 사람이 만진 칸. 그 칸은 건드리지 않는다(타이핑 중 커서 튐 방지). */
  window.peCalc = function (src) {
    var box = document.getElementById('pe_calc'); if (!box) return;
    var elSell = document.getElementById('pe_sell'), elMg = document.getElementById('pe_mg');
    var buy = parseInt(document.getElementById('pe_buy').value, 10);
    var ship = parseInt(document.getElementById('pe_ship').value, 10) || 0;

    if (isNaN(buy)) {
      box.innerHTML = '<div class="pe-warn">매입가를 넣으면 손익분기·마진이 계산됩니다</div>';
      return;
    }
    var cost = buy + ship;
    var bep = Math.ceil(cost / 0.9 / 100) * 100;      // 손익분기(수수료 10% 감안)
    var auto = Math.ceil(cost / 0.65 / 100) * 100;    // 판매가 미입력 시 자동산출
    var sell = parseInt(elSell.value, 10);
    var mgIn = parseInt(elMg.value, 10);
    var backCalc = false;

    if (src === 'mg' && !isNaN(mgIn)) {
      /* 마진률 → 판매가 역산 */
      if (mgIn >= 90) {                                // 수수료 10% 때문에 90% 이상은 수학적으로 불가
        box.innerHTML = '<div class="pe-warn">⚠️ 마진률은 90% 미만만 가능합니다(플랫폼 수수료 10% 때문)</div>';
        return;
      }
      var denom = 0.9 - (mgIn / 100);
      if (denom <= 0) { box.innerHTML = '<div class="pe-warn">⚠️ 불가능한 마진률입니다</div>'; return; }
      sell = Math.ceil(cost / denom / 100) * 100;      // 100원 단위 올림
      elSell.value = sell;                             // 판매가 칸을 채워준다
      backCalc = true;
    } else if (isNaN(sell)) {
      sell = auto;                                     // 판매가 비었으면 자동산출값으로 계산
    }

    var net = Math.round(sell * 0.9 - cost);
    var mg = Math.round(net / sell * 100);
    if (src !== 'mg') elMg.value = mg;                 // 판매가를 만졌으면 마진칸을 갱신(반대는 안 함)

    var cls = mg >= 40 ? 'good' : (mg < 20 ? 'bad' : 'mid');
    var warn = '';
    if (sell < bep) warn = '<div class="pe-warn" style="color:#dc2626">🚨 손익분기 아래 — 팔수록 손해입니다</div>';
    else if (backCalc && mg !== mgIn) warn = '<div class="pe-warn">ℹ️ 100원 단위로 맞추느라 실제 마진은 ' + mg + '%가 됩니다</div>';

    box.innerHTML =
      '<div class="pe-line"><span>원가(매입+배송)</span><b>' + won(cost) + '</b></div>'
      + '<div class="pe-line"><span>손익분기 <i>이 아래로 팔면 손해</i></span><b>' + won(bep) + '</b></div>'
      + '<div class="pe-line"><span>판매가' + (backCalc ? ' <i>(마진률로 역산)</i>' : (parseInt(elSell.value, 10) === auto && !elSell.value ? ' <i>(자동산출)</i>' : '')) + '</span><b>' + won(sell) + '</b></div>'
      + '<div class="pe-line big"><span>마진 <i>판매가×0.9 − 원가</i></span>'
      + '<b><span class="mgb ' + cls + '">' + mg + '%</span> ' + won(net) + '</b></div>'
      + warn;
  };

  window.saveProduct = function (pid) {
    var i = _pidx(pid); if (i < 0) return;
    var g = function (id) { return (document.getElementById(id) || {}).value; };
    var num = function (id) { var n = parseInt(g(id), 10); return isNaN(n) ? null : n; };
    var patch = {
      name: (g('pe_name') || '').trim() || V2.products[i].name,
      spec: (g('pe_spec') || '').trim(),
      buy: num('pe_buy'),
      ship: num('pe_ship') || 0,
      sell: num('pe_sell'),
      mkt: (g('pe_mkt') || '').trim(),
      note: (g('pe_note') || '').trim()
    };
    var ref = wdb.ref(R + 'products/' + i);
    ref.update(patch, function (err) {
      if (err) { toast('❌ 저장 실패'); return; }
      toast('✅ ' + patch.name + ' 저장됨 — 모든 기기 반영');
      closeModal();
    });
  };

  window.delProduct = function (pid) {
    var i = _pidx(pid); if (i < 0) return;
    var p = V2.products[i];
    if (!confirm('“' + p.name + '” 제품을 삭제할까요?\n(거래처는 그대로 남습니다)')) return;
    /* 배열에서 빼고 전체 재작성 — 부분 삭제는 인덱스가 밀려 다른 제품이 섞인다 */
    var np = V2.products.filter(function (x) { return x.pid !== pid; });
    wdb.ref(R + 'products').set(np, function (err) {
      if (err) { toast('❌ 삭제 실패'); return; }
      toast('🗑 ' + p.name + ' 삭제됨'); closeModal();
    });
  };

  /* 제품 카드에 클릭 붙이기 — 기존 pcardHtml 을 감싸서 확장(원본 유지) */
  var _origPcard = window.pcardHtml;
  if (typeof _origPcard === 'function') {
    window.pcardHtml = function (p) {
      var html = _origPcard(p);
      if (!p || !p.pid) return html;
      return html.replace('<div class="pcard">',
        '<div class="pcard pcard-edit" onclick="event.stopPropagation();editProduct(\'' + p.pid + '\')" title="눌러서 수정">');
    };
  }

  /* ---------- 5) 토스트 ---------- */
  function toast(msg) {
    var t = document.getElementById('v2toast');
    if (!t) { t = document.createElement('div'); t.id = 'v2toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'on';
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = ''; }, 2600);
  }
  window.v2toast = toast;

  /* ---------- 6) 첫 화면 render override (요구 2 배지 + 작업바) ---------- */
  var _origRender = window.render;
  window.render = function () {
    var D = window.DASH;
    var q = ((document.getElementById('search') || {}).value || '').toLowerCase();
    var view = document.getElementById('view'), foot = document.getElementById('foot');
    if (!view || !D || !D.suppliers) { return _origRender && _origRender(); }
    if (window.__TAB === 'margin') { return renderMarginTab(); }

    var list = D.suppliers.filter(function (s) {
      return (s.name + s.cat + (s.products || []).map(function (p) { return p.name; }).join()).toLowerCase().indexOf(q) >= 0;
    });
    var BADGE = { ok: ['b-ok', '✅ 발주가능'], star: ['b-ok', '⭐ 확보·검수'], check: ['b-check', '❓ 확인필요'], new: ['b-new', '🔹 발굴'], no: ['b-no', '❌ 제외'] };
    view.innerHTML = '<div id="v2jobbar"></div><div class="grid">' + list.map(function (s) {
      var b = BADGE[s.status] || BADGE.new;
      var prods = s.products || [];
      var vals = prods.map(recOf).filter(function (x) { return x != null; });
      var range = !vals.length ? '단가 확인필요' : (Math.min.apply(null, vals) === Math.max.apply(null, vals) ? won(vals[0]) : won(Math.min.apply(null, vals)) + ' ~ ' + won(Math.max.apply(null, vals)));
      return '<div class="vcard" onclick="openSup(' + D.suppliers.indexOf(s) + ')">' +
        '<div class="vtop"><div class="avatar">' + s.emoji + '</div><div><div class="vname">' + esc(s.name) + '</div><div class="vcat">' + esc(s.cat) + '</div></div></div>' +
        '<div class="badgerow"><span class="badge ' + b[0] + '">' + b[1] + '</span>' + deadlineBadge(s) + '</div>' +
        '<div class="vmeta"><div><div class="k">품목</div><div class="v">' + prods.length + '개</div></div>' +
        '<div style="text-align:right"><div class="k">추천 판매가</div><div class="v price-range">' + range + '</div></div></div></div>';
    }).join('') + '</div>';
    if (foot) foot.textContent = '💡 카드를 누르면 제품·주문양식·주문수집이 열립니다. 🕐는 택배 마감시간.';
    renderJobBar();
  };

  /* ---------- 7) 제품·마진 탭 (요구 4) ---------- */
  window.__TAB = 'vendors';
  window.switchTab = function (t) {
    window.__TAB = t;
    var bar = document.getElementById('v2tabs');
    if (bar) for (var i = 0; i < bar.children.length; i++) bar.children[i].classList.toggle('on', bar.children[i].dataset.t === t);
    window.render();
  };
  function renderMarginTab() {
    var D = window.DASH, view = document.getElementById('view'), foot = document.getElementById('foot');
    var q = ((document.getElementById('search') || {}).value || '').toLowerCase();
    var rows = [];
    (D.suppliers || []).forEach(function (s) {
      (s.products || []).forEach(function (p) {
        if ((p.name + (p.spec || '') + s.name).toLowerCase().indexOf(q) < 0) return;
        rows.push({ s: s, p: p, mg: mgOf(p), rec: recOf(p) });
      });
    });
    var sortBy = window.__MSORT || 'mg';
    rows.sort(function (a, b) {
      if (sortBy === 'mg') return (b.mg == null ? -999 : b.mg) - (a.mg == null ? -999 : a.mg);
      if (sortBy === 'sell') return (b.rec || 0) - (a.rec || 0);
      return (a.p.name || '').localeCompare(b.p.name || '');
    });
    var withMg = rows.filter(function (r) { return r.mg != null; });
    var avg = withMg.length ? Math.round(withMg.reduce(function (t, r) { return t + r.mg; }, 0) / withMg.length) : null;
    var hi = withMg.filter(function (r) { return r.mg >= 40; }).length;
    var lo = withMg.filter(function (r) { return r.mg < 20; }).length;

    view.innerHTML =
      '<div class="msum">' +
      '<div class="mstat"><span>전체 제품</span><b>' + rows.length + '</b></div>' +
      '<div class="mstat"><span>마진 산출가능</span><b>' + withMg.length + '</b></div>' +
      '<div class="mstat"><span>평균 마진</span><b>' + (avg == null ? '–' : avg + '%') + '</b></div>' +
      '<div class="mstat good"><span>고마진 40%↑</span><b>' + hi + '</b></div>' +
      '<div class="mstat bad"><span>저마진 20%↓</span><b>' + lo + '</b></div>' +
      '</div>' +
      '<div class="msort">정렬: ' +
      ['mg:마진순', 'sell:판매가순', 'name:이름순'].map(function (o) {
        var k = o.split(':')[0];
        return '<button class="sb' + (sortBy === k ? ' on' : '') + '" onclick="window.__MSORT=\'' + k + '\';render()">' + o.split(':')[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="mtblwrap"><table class="mtbl"><thead><tr>' +
      '<th>제품</th><th>거래처</th><th class="r">매입가</th><th class="r">판매가</th><th class="r">마진</th><th class="r">마진액</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        var p = r.p, cost = (p.buy == null ? null : p.buy + (p.ship || 0));
        var mgAmt = (r.rec != null && cost != null) ? Math.round(r.rec * 0.9 - cost) : null;
        var cls = r.mg == null ? '' : (r.mg >= 40 ? 'good' : (r.mg < 20 ? 'bad' : 'mid'));
        return '<tr>' +
          '<td><b>' + (p.emoji || '📦') + ' ' + esc(p.name) + '</b><div class="sub">' + esc(p.spec || '') + (p.note ? ' · ' + esc(p.note).slice(0, 40) : '') + '</div></td>' +
          '<td class="sub">' + esc(r.s.name.split('·')[0]) + '</td>' +
          '<td class="r">' + (p.buy == null ? '<span class="need">확인필요</span>' : won(p.buy) + (p.ship ? '<div class="sub">+배송 ' + p.ship.toLocaleString() + '</div>' : '')) + '</td>' +
          '<td class="r">' + (r.rec == null ? '–' : won(r.rec) + (p.sell == null ? '<div class="sub">자동산출</div>' : '')) + '</td>' +
          '<td class="r"><span class="mgb ' + cls + '">' + (r.mg == null ? '–' : r.mg + '%') + '</span></td>' +
          '<td class="r">' + (mgAmt == null ? '–' : won(mgAmt)) + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table></div>';
    if (foot) foot.innerHTML = '💡 마진 = 판매가×0.9(수수료 10% 차감) − (매입가+배송비). 판매가 미입력 제품은 매입가÷0.65로 <b>자동산출</b>한 값입니다.';
  }

  /* ---------- 8) 거래처 모달 확장 (양식·마감·수집) ---------- */
  // 양식 업로드·마감 저장은 RTDB에 바로 쓰이지만, 열려 있는 모달은 그 순간 화면이 굳어 있다.
  // (저장했는데 모달엔 안 뜨는 문제) → 데이터가 바뀌면 열린 모달을 조용히 다시 그린다.
  var _openIdx = null;
  function reopenIfOpen() {
    var ov = document.getElementById('overlay');
    if (!ov || !ov.classList.contains('on') || _openIdx == null) return;
    var sc = ov.scrollTop;                    // 스크롤 위치 보존(안 하면 위로 튄다)
    window.openSup(_openIdx);
    ov.scrollTop = sc;
  }
  var _origOpenSup = window.openSup;
  window.openSup = function (i) {
    _openIdx = i;
    _origOpenSup(i);                       // 기존 모달 먼저 그림
    var s = (window.DASH.suppliers || [])[i]; if (!s) return;
    var modal = document.getElementById('modal'); if (!modal) return;
    var d = deadlineOf(s), f = V2.forms[s.id];
    var box = document.createElement('div');
    box.className = 'v2box';
    box.innerHTML =
      '<div class="v2sec">' +
      '<div class="v2h">🕐 택배 마감시간</div>' +
      '<div class="v2row">' +
      '<input id="v2dl" class="v2in" value="' + esc(d.guess ? '' : d.txt) + '" placeholder="' + (d.guess ? '추정: ' + esc(d.txt) + ' — 확정값 입력' : '예) 평일 16:00') + '">' +
      '<button class="v2btn" onclick="saveDeadline(\'' + s.id + '\', document.getElementById(\'v2dl\').value)">저장</button>' +
      '</div>' +
      (d.guess ? '<div class="v2note">⚠️ 지금 값은 메모에서 뽑은 <b>추정</b>입니다("' + esc(d.txt) + '"). 확정값을 넣어주세요.</div>' : '') +
      '</div>' +

      '<div class="v2sec">' +
      '<div class="v2h">📋 주문 양식</div>' +
      (f ? '<div class="v2file"><b>' + esc(f.name) + '</b><span>' + Math.round(f.size / 1024) + 'KB · ' + esc(f.at) + '</span>' +
        '<button class="v2btn sm" onclick="downloadForm(\'' + s.id + '\')">⬇</button>' +
        '<button class="v2btn sm ghost" onclick="deleteForm(\'' + s.id + '\')">✕</button></div>'
        : '') +
      '<div class="v2drop" id="v2drop">' +
      '<div>📎 주문 양식 파일을 여기로 <b>끌어다 놓으세요</b></div>' +
      '<div class="v2sub">엑셀·CSV·PDF (4MB 이하) · 또는 눌러서 선택</div>' +
      '<input type="file" id="v2f" style="display:none" accept=".xlsx,.xls,.csv,.pdf">' +
      '</div>' +
      '</div>' +

      '<div class="v2sec">' +
      '<div class="v2h">📤 주문 수집</div>' +
      '<button class="v2big" onclick="requestCollect(\'' + s.id + '\',\'' + esc(s.name).replace(/'/g, "\\'") + '\')">🛒 테무 주문 수집 요청</button>' +
      '<div class="v2note">폰·데스크톱에서 눌러도 <b>실제 수집은 노트북</b>이 합니다(테무 로그인이 거기에만 있음).<br>노트북이 꺼져 있으면 <b>대기중</b>으로 남았다가 켜지면 자동 처리됩니다. 완료되면 첫 화면에 ⬇다운로드 버튼이 뜹니다.</div>' +
      '</div>' +

      '<div class="v2danger">' +
      '<button class="v2del" onclick="deleteVendor(\'' + s.id + '\')">🗑 이 거래처 삭제</button>' +
      '<div class="v2sub">제품 ' + (s.products || []).length + '개도 함께 삭제됩니다 · 휴지통에 보관되어 복구 가능</div>' +
      '</div>';
    modal.appendChild(box);

    // 드래그앤드롭 배선
    var dz = box.querySelector('#v2drop'), fi = box.querySelector('#v2f');
    dz.addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function () { if (this.files[0]) window.uploadForm(s.id, this.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) window.uploadForm(s.id, file);
    });
  };

  /* ---------- 8-2) 휴지통 칩 (헤더) — 비어있으면 아예 안 보인다 ---------- */
  function renderTrashChip() {
    var chips = document.getElementById('chips'); if (!chips) return;
    var n = Object.keys(V2.trash || {}).length;
    var old = document.getElementById('v2trchip');
    if (!n) { if (old) old.remove(); return; }
    var html = '<div class="chip gchip" id="v2trchip" style="cursor:pointer" onclick="openTrash()">🗑 휴지통<b>' + n + '건</b></div>';
    if (old) old.outerHTML = html; else chips.insertAdjacentHTML('beforeend', html);
  }

  /* ---------- 9) 탭바 주입 ---------- */
  function injectTabs() {
    var tabs = document.querySelector('.tabs'); if (!tabs || document.getElementById('v2tabs')) return;
    var bar = document.createElement('div');
    bar.id = 'v2tabs'; bar.className = 'v2tabs';
    bar.innerHTML = '<button class="v2tab on" data-t="vendors" onclick="switchTab(\'vendors\')">🏢 거래처</button>' +
      '<button class="v2tab" data-t="margin" onclick="switchTab(\'margin\')">💰 제품·마진</button>';
    tabs.insertBefore(bar, tabs.firstChild);
  }

  /* ---------- 10) 시작 ---------- */
  function start() { injectTabs(); boot(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
