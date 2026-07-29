/* ============================================================
   위탁 대시보드 v3 패치 (2026-07-27, 사장님 지시 ■2·■3)
   2) 품목 카드 '등록 판정' 배지 + 근거 1줄 + [GO만 보기] 필터
   3) 자료실 2종 — ① 제품 자료(사장님 원본) ② 상세 이미지(작업물)
      업로드(드래그앤드롭) · 개별 다운로드 · 전체 ZIP · 삭제
      접근키(?k=) 없으면 자료실 숨김 · 확장자/용량 제한

   설계: 기존 코드를 고치지 않고 override 로 얹는다(v2와 동일 원칙).
   저장소: RTDB shared/wholesale/files/<거래처키>/{src,work}
      ※ Firebase Storage 는 이 프로젝트에 아직 버킷이 없다(2026-07-27 실측 404).
        Storage 가 열리면 a2Store 만 교체하면 되도록 입출력을 함수로 격리해 둠.
   ============================================================ */
(function () {
  'use strict';
  /* ■1 단일 진입 URL — 이 페이지(사장님 전체화면)는 dash.html 을 거쳐 들어온다.
     via=dash 가 없으면 단일 URL 로 돌려보낸다(키 검사는 dash.html 이 한다). */
  /* ★자동 새로고침이 location.pathname+'?_r=' 로 갈아치우면서 k·via 가 날아간다(실측).
     그대로 두면 새로고침 한 번에 사장님 화면이 빈 화면으로 떨어진다.
     → 들어올 때 키를 세션에 적어 두고, 파라미터가 사라지면 원래 주소로 복구한다. */
  var _KEY = '';
  try {
    var _q = new URLSearchParams(location.search);
    if (_q.get('via') === 'dash') {
      _KEY = _q.get('k') || '';
      sessionStorage.setItem('w_via', '1');
      if (_KEY) sessionStorage.setItem('w_key', _KEY);
    } else if (sessionStorage.getItem('w_via') === '1') {
      _KEY = sessionStorage.getItem('w_key') || '';
      location.replace(location.pathname + '?k=' + encodeURIComponent(_KEY) + '&via=dash');
      return;
    } else { location.replace('dash.html' + location.search); return; }
  } catch (e) { }
  /* RTDB 는 REST 로 직접 읽고 쓴다 — 웹소켓 SDK 가 막힌 환경에서도 자료실이 살아 있게. */
  var DB = 'https://consult-crm-cfef6-default-rtdb.asia-southeast1.firebasedatabase.app';
  var R = 'shared/wholesale/';
  function api(path, opt) { return fetch(DB + '/' + path + '.json', opt).then(function (r) { return r.json(); }); }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); };
  var won = function (n) { return n == null ? '–' : Number(n).toLocaleString() + '원'; };
  function toast(m) { if (window.v2toast) window.v2toast(m); else console.log(m); }

  /* ========== ■2 판정 배지 — 시스템 '제안' + 사장님 '확정' 2단 ==========
     (2026-07-27 지시서 ■1) 조사 결과는 제안일 뿐이고, 최종은 사장님 확정값이다.
     확정값 저장 위치 = RTDB shared/wholesale/confirm/<pid> · 이력 = confirmlog */
  var VD = { GO: ['go', '🟢 GO'], HOLD: ['hold', '🟡 보류'], NOGO: ['no', '🔴 부적합'] };
  var CF = {};                                    /* {pid:{verdict,at,by}} */

  function loadConfirm(again) {
    api(R + 'confirm').then(function (v) {
      CF = v || {};
      if (again && window.__reopenSup) window.__reopenSup();
    }, function () { });
  }
  window.jbSet = function (pid, v) {
    var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
    var now = d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
    var body = { verdict: v, at: now, by: '사장님' };
    api(R + 'confirm/' + encodeURIComponent(pid), { method: 'PUT', body: JSON.stringify(body) })
      .then(function () { return api(R + 'confirmlog', { method: 'POST', body: JSON.stringify({ pid: pid, verdict: v, ts: now, by: '사장님' }) }); })
      .then(function () {
        CF[pid] = body;
        toast('✅ ' + pid + ' → ' + VD[v][1] + ' 확정' + (v === 'GO' ? ' (대행자 화면에 바로 뜹니다)' : ''));
        if (window.__reopenSup) window.__reopenSup();
      }, function (e) { toast('❌ 확정 저장 실패: ' + (e && e.message)); });
  };
  window.jbClear = function (pid) {
    api(R + 'confirm/' + encodeURIComponent(pid), { method: 'DELETE' }).then(function () {
      delete CF[pid]; toast('↩ 확정을 지웠습니다 (다시 확정 대기)');
      if (window.__reopenSup) window.__reopenSup();
    });
  };

  /* ================= V2-A 명세 리스트형 카드 (2026-07-27 사장님 확정 디자인) =====
     ① 제안 배지 + 확정 버튼 ② 테무 상위3 vs 우리 표 ③ 비교 요약 1줄
     ④ 배송비 3박스 ⑤ 판매가⇄마진율 양방향 ⑥ 건당 정산 명세 + 순수익 밴드
     상수는 화면에 박지 않는다 — RTDB shared/wholesale/policy (원본 _데이터소스\policy.json). */
  var POL = null;          /* 정본 상수 */
  var PRICE = {};          /* {pid:{sell,margin_pct,at,by}} 사장님이 정한 판매가 */
  var PMAP = {};           /* {pid:product} 계산할 때 원본을 찾기 위한 색인 */

  function polOK() { return !!(POL && POL.fee_rate != null); }
  function nowStr() {
    var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  /* 택배비 우선순위 (2026-07-29 사장님 지시)
       ① 사장님이 카드에서 직접 고친 값  ② 거래처 정책·조사 계산값  ③ 정본 기본값
     ※ 저장 위치는 price/<pid>.cour — products 노드는 보안 규칙상 화면에서 못 쓴다(실측 확인).
        그래서 배송비만 따로 이 노드에 얹는다. 대행자 화면도 같은 노드를 읽으므로 함께 반영된다. */
  function courOf(p) {
    var r = PRICE[p.pid];
    if (r && r.cour != null) return r.cour;
    var j = p.judge || {};
    return j.courier != null ? j.courier : (polOK() ? POL.courier_cost_default : null);
  }
  function courBase(p) {                    /* 사장님 지정을 뺀 '원래' 값 — 되돌리기용 */
    var j = p.judge || {};
    return j.courier != null ? j.courier : (polOK() ? POL.courier_cost_default : null);
  }
  function courSrc(p) {
    var r = PRICE[p.pid];
    if (r && r.cour != null) return (r.cour_by || '사장님') + ' 직접 지정';
    var j = p.judge || {};
    return j.courier != null ? '거래처 배송정책' : '정본 기본값(실비 미확보)';
  }
  function priceOf(p) {
    var r = PRICE[p.pid];
    if (r && r.sell != null) return r.sell;
    var j = p.judge || {};
    return j.price_reco != null ? j.price_reco : (p.sell != null ? p.sell : null);
  }
  function u100(price, g) { return (price == null || !g) ? null : Math.round(price * 100 / g); }

  /* 정산: 순수익 = 판매가 − 매입원가 + 고객배송비 − 거래처택배비 − 수수료(판매가×요율) */
  function settle(price, buy, cour) {
    if (!polOK() || price == null || buy == null || cour == null || !price) return null;
    var fee = Math.round(price * POL.fee_rate);
    var cred = price < POL.free_ship_threshold ? POL.customer_ship_credit : 0;
    var net = price - buy + cred - cour - fee;
    return { price: price, buy: buy, cour: cour, fee: fee, cred: cred, net: net, pct: Math.round(net / price * 100) };
  }
  /* 마진율(%) → 판매가 역산 (100원 단위 반올림). 19,800 경계를 넘으면 수취 없이 다시 푼다. */
  function solvePrice(m, buy, cour) {
    if (!polOK() || buy == null || cour == null || !isFinite(m)) return null;
    var f = POL.fee_rate, C = POL.customer_ship_credit, L = POL.free_ship_threshold, t = m / 100;
    if (1 - f - t <= 0.02) return null;                      /* 수학적으로 불가능한 마진 */
    var p = Math.round(((buy + cour - C) / (1 - f - t)) / 100) * 100;
    if (p >= L) p = Math.round(((buy + cour) / (1 - f - t)) / 100) * 100;
    return p > 0 ? p : null;
  }

  /* ── ② 비교표 ── */
  /* 숫자끼리 붙어 보이지 않게 단위(원·g)는 머리글로 빼고 칸에는 숫자만 넣는다 */
  var numf = function (n) { return n == null ? '<span class="na">–</span>' : Number(n).toLocaleString(); };
  function cmpTable(p, price) {
    var t3 = (p.temu_top3 || []).slice(0, 3), g = p.unit_g || null, rows = '';
    t3.forEach(function (t, i) {
      var uu = (t.price != null && t.qty_g) ? u100(t.price, t.qty_g) : null;
      rows += '<tr><td class="rk">' + (t.rank || i + 1) + '위' +
        (t.url ? '<a class="tt" href="' + esc(t.url) + '" target="_blank" title="' + esc(t.title) + '">' + esc(t.title || '') + '</a>'
          : '<span class="tt" title="' + esc(t.title) + '">' + esc(t.title || '') + '</span>') + '</td>' +
        '<td>' + numf(t.price) + '</td>' +
        '<td>' + (t.qty_g ? numf(t.qty_g) : '<span class="na">미기록</span>') + '</td>' +
        '<td>' + numf(uu) + '</td>' +
        '<td>' + numf(t.sales) + '</td></tr>';
    });
    rows += '<tr class="ours"><td class="rk">우리<span class="tt">' + esc(p.name || '') + '</span></td>' +
      '<td id="v2op_' + p.pid + '">' + numf(price) + '</td>' +
      '<td>' + (g ? numf(g) : '<span class="na">미기록</span>') + '</td>' +
      '<td id="v2ou_' + p.pid + '">' + numf(u100(price, g)) + '</td>' +
      '<td>–</td></tr>';
    if (!t3.length) return '<div class="cmpwrap"><table class="cmp"><tbody>' + rows + '</tbody></table></div>';
    return '<div class="cmpwrap"><table class="cmp"><thead><tr><th>상품</th><th>판매가<i>원</i></th><th>중량<i>g</i></th>' +
      '<th>100g당<i>원</i></th><th>판매량</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ── ③ 요약 1줄 (지어내지 않는다 — 값이 없으면 없다고 쓴다) ── */
  function cmpSum(p, price) {
    var t3 = p.temu_top3 || [], out = [];
    if (!t3.length || price == null) return '';
    var t1 = t3[0];
    if (t1.price != null) {
      var d = t1.price - price;
      out.push(d > 0 ? '1위 대비 <b>' + won(d) + ' 저렴</b>' : (d < 0 ? '1위 대비 <b class="up">' + won(-d) + ' 비쌈</b>' : '1위와 같은 가격'));
    }
    var g = p.unit_g, have = t3.filter(function (t) { return t.qty_g && t.price != null; });
    if (g && have.length) {
      var mine = u100(price, g), lo = Math.min.apply(null, have.map(function (t) { return u100(t.price, t.qty_g); }));
      out.push(mine <= lo ? '<b>100g당 최저가</b> (' + mine.toLocaleString() + '원)'
        : '100g당 ' + mine.toLocaleString() + '원 <span class="na">(테무 최저 ' + lo.toLocaleString() + '원)</span>');
    } else out.push('<span class="na">중량 미기록 — 100g당 비교 불가</span>');
    return '<div class="cmpsum" id="v2sum_' + p.pid + '">' + out.join(' · ') + '</div>';
  }

  /* ■5 동일상품 미발견 처리 */
  function cmpNote(p) {
    var j = p.judge || {};
    if (j.similar) return '<div class="cmpnote">※ 동일상품 없음 — <b>유사상품(' + esc(j.similar) + ') 기준</b> 비교</div>';
    if (!(p.temu_top3 && p.temu_top3.length))
      return '<div class="cmpnote none">※ <b>비교 불가</b> — 테무에서 동종 상품 미발견(검색은 실시함). ' +
        '유사상품도 아직 못 찾아 값을 지어내지 않습니다. <b>다음 조사 회차에 보강</b>합니다.</div>';
    return '';
  }

  /* ── ④ 배송비 3박스 / ⑥ 명세·순수익 ── */
  function shipHtml(s) {
    var real = s.cour - s.cred;
    return '<div class="sbx minus"><div class="k">거래처에 냄</div><div class="v">−' + won(s.cour) + '</div></div>' +
      '<div class="sbx plus"><div class="k">고객에게 받음</div><div class="v">' + (s.cred ? '+' + won(s.cred) : '없음') + '</div></div>' +
      '<div class="sbx net"><div class="k">실질 부담</div><div class="v">' +
      (real > 0 ? '−' + won(real) : (real < 0 ? '+' + won(-real) : '0원')) + '</div></div>';
  }
  function lrow(sign, name, v) {
    return '<div class="ldr ' + (sign === '+' ? 'p' : (sign === '-' ? 'm' : '')) + '"><span class="n">' + name + '</span>' +
      '<span class="v">' + (sign === '0' ? '0원' : sign + won(v)) + '</span></div>';
  }
  function ledHtml(s) {
    return lrow('+', '판매가', s.price) +
      (s.cred ? lrow('+', '고객 배송비 <small>(19,800원 미만)</small>', s.cred)
        : lrow('0', '고객 배송비 <small>(무료배송 구간)</small>', 0)) +
      lrow('-', '매입원가', s.buy) +
      lrow('-', '거래처 택배비', s.cour) +
      lrow('-', '테무 수수료 <small>(' + Math.round(POL.fee_rate * 1000) / 10 + '%)</small>', s.fee);
  }
  function netHtml(s) {
    return '<span>건당 순수익 ' + (s.net > 0 ? won(s.net) : '<b>' + won(s.net) + '</b>') + '</span>' +
      '<small>마진 ' + s.pct + '%</small>';
  }
  function warnHtml(s) {
    if (!polOK()) return '';
    var L = POL.free_ship_threshold;
    if (s.price >= L) return '<div class="cvwarn">⚠️ <b>' + won(L) + ' 이상 = 무료배송</b> — 고객 배송비 수취가 사라져 택배비 ' +
      won(s.cour) + '을 전액 우리가 냅니다.</div>';
    if (s.price >= L - 1500) return '<div class="cvwarn ok">ℹ️ ' + won(L) + '까지 <b>' + won(L - s.price) + '</b> 남았습니다. 넘기면 배송비 ' +
      won(POL.customer_ship_credit) + ' 수취가 사라집니다.</div>';
    return '';
  }

  /* ── ⑤ 입력칸 (사장님 키에서만 수정 가능) ── */
  function calcRow(p, s) {
    var ro = hasKey() ? '' : ' readonly';
    var over = (PRICE[p.pid] || {}).cour != null;
    /* 배송비는 한 줄을 통째로 쓴다 — 390px 폰에서 3칸으로 쪼개면 숫자가 붙어 보인다(2026-07-27 실측 교훈) */
    return '<div class="calcrow one"><div class="cfield' + (over ? ' edited' : '') + '">' +
      '<label>거래처 택배비 <i>· ' + courSrc(p) + '</i></label><div class="inw">' +
      '<input id="v2ci_' + p.pid + '" type="number" step="100" inputmode="numeric" value="' + s.cour + '"' + ro +
      ' oninput="v2Calc(\'' + p.pid + '\',\'c\')" onchange="v2Save(\'' + p.pid + '\')"><span class="u">원</span>' +
      (over && hasKey() ? '<button class="curev" onclick="v2CourReset(\'' + p.pid + '\')" title="원래 값으로">↩</button>' : '') +
      '</div></div></div>' +
      '<div class="calcrow">' +
      '<div class="cfield"><label>판매가 (등록가)</label><div class="inw">' +
      '<input id="v2pi_' + p.pid + '" type="number" step="100" inputmode="numeric" value="' + s.price + '"' + ro +
      ' oninput="v2Calc(\'' + p.pid + '\',\'p\')" onchange="v2Save(\'' + p.pid + '\')"><span class="u">원</span></div></div>' +
      '<div class="cfield"><label>마진율</label><div class="inw">' +
      '<input id="v2mi_' + p.pid + '" type="number" step="1" inputmode="numeric" value="' + s.pct + '"' + ro +
      ' oninput="v2Calc(\'' + p.pid + '\',\'m\')" onchange="v2Save(\'' + p.pid + '\')"><span class="u">%</span></div></div>' +
      '</div>' + (hasKey() ? '' : '<div class="rolock">🔒 열람 전용 — 판매가 수정은 사장님 화면에서만 됩니다.</div>');
  }

  /* 값이 바뀌면 표·배송·명세·밴드를 즉시 다시 그린다 */
  window.v2Calc = function (pid, src) {
    var p = PMAP[pid]; if (!p) return;
    var pe = document.getElementById('v2pi_' + pid), me = document.getElementById('v2mi_' + pid);
    if (!pe || !me) return;
    /* 배송비 칸이 있으면 그 값이 기준이다 — 사장님이 방금 고친 값을 즉시 반영해야 한다 */
    var ce = document.getElementById('v2ci_' + pid);
    var buy = p.buy, price;
    var cour = ce ? parseInt(String(ce.value).replace(/[^\d]/g, ''), 10) : courOf(p);
    if (cour == null || isNaN(cour)) cour = courOf(p);
    if (src === 'm') {
      price = solvePrice(parseFloat(me.value), buy, cour);
      if (price == null) return;
      pe.value = price;
    } else {
      price = parseInt(String(pe.value).replace(/[^\d]/g, ''), 10);
      if (!price) return;
    }
    var s = settle(price, buy, cour); if (!s) return;
    /* 배송비를 고친 경우엔 판매가를 그대로 두고 마진율만 다시 계산해 보여준다 */
    if (src !== 'm') me.value = s.pct;
    var set = function (id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; };
    set('v2op_' + pid, numf(price));
    set('v2ou_' + pid, numf(u100(price, p.unit_g)));
    var sm = document.getElementById('v2sum_' + pid);
    if (sm) sm.outerHTML = cmpSum(p, price) || '<div class="cmpsum" id="v2sum_' + pid + '"></div>';
    set('v2ship_' + pid, shipHtml(s));
    set('v2led_' + pid, ledHtml(s));
    set('v2warn_' + pid, warnHtml(s));
    var nb = document.getElementById('v2net_' + pid);
    if (nb) { nb.className = 'netband' + (s.net <= 0 ? ' bad' : ''); nb.innerHTML = netHtml(s); }
  };

  /* 사장님이 정한 값은 이력과 함께 남긴다 (지시 ■3) */
  window.v2Save = function (pid) {
    if (!hasKey()) return;
    var p = PMAP[pid], pe = document.getElementById('v2pi_' + pid); if (!p || !pe) return;
    var price = parseInt(String(pe.value).replace(/[^\d]/g, ''), 10); if (!price) return;
    /* 배송비도 함께 저장한다. 원래 값과 같으면 굳이 사장님 지정으로 박제하지 않는다(되돌릴 여지를 남김). */
    var ce = document.getElementById('v2ci_' + pid);
    var cour = ce ? parseInt(String(ce.value).replace(/[^\d]/g, ''), 10) : null;
    if (cour == null || isNaN(cour) || cour < 0) cour = null;
    var keep = (cour != null && cour !== courBase(p)) ? cour : null;
    var s = settle(price, p.buy, cour != null ? cour : courOf(p));
    var body = { sell: price, margin_pct: s ? s.pct : null, at: nowStr(), by: '사장님' };
    if (keep != null) { body.cour = keep; body.cour_by = '사장님'; }
    api(R + 'price/' + encodeURIComponent(pid), { method: 'PUT', body: JSON.stringify(body) })
      .then(function () { return api(R + 'pricelog', { method: 'POST', body: JSON.stringify({ pid: pid, sell: price, margin_pct: body.margin_pct, cour: keep, ts: body.at, by: '사장님' }) }); })
      .then(function () {
        PRICE[pid] = body;
        toast('💾 ' + pid + ' 저장 — 판매가 ' + won(price) + ' · 마진 ' + body.margin_pct + '%' +
          (keep != null ? ' · 배송비 ' + won(keep) : '') + ' (대행자·다른 기기에도 반영)');
        if (window.v2Repaint) window.v2Repaint(pid);
      }, function () { toast('❌ 저장 실패 — 다시 눌러 주세요'); });
  };

  /* 배송비를 원래 값(거래처 정책·조사값)으로 되돌린다 */
  window.v2CourReset = function (pid) {
    if (!hasKey()) return;
    var p = PMAP[pid]; if (!p) return;
    var cur = PRICE[pid] || {};
    var body = { sell: cur.sell != null ? cur.sell : priceOf(p), margin_pct: cur.margin_pct != null ? cur.margin_pct : null, at: nowStr(), by: '사장님' };
    api(R + 'price/' + encodeURIComponent(pid), { method: 'PUT', body: JSON.stringify(body) })
      .then(function () {
        PRICE[pid] = body;
        toast('↩ ' + pid + ' 배송비를 원래 값 ' + won(courBase(p)) + '으로 되돌렸습니다');
        if (window.v2Repaint) window.v2Repaint(pid);
      }, function () { toast('❌ 되돌리기 실패 — 다시 눌러 주세요'); });
  };

  /* [제품 정보 수정] 모달의 배송비 칸도 실제로 반영되게 한다.
     모달은 products 노드에 쓰는데 그 노드는 보안 규칙상 화면에서 쓰기가 막혀 있다(2026-07-29 실측).
     그래서 배송비만은 쓰기가 열려 있는 price/<pid>.cour 로 따로 저장한다. */
  (function wrapSaveProduct() {
    var orig = window.saveProduct;
    if (typeof orig !== 'function') return;
    window.saveProduct = function (pid) {
      var el = document.getElementById('pe_ship');
      var v = el ? parseInt(String(el.value).replace(/[^\d]/g, ''), 10) : NaN;
      try { orig(pid); } catch (e) { }
      var p = PMAP[pid];
      if (!p || isNaN(v) || v < 0) return;
      if (!hasKey()) return;
      if (v === courOf(p)) return;                       /* 안 바뀌었으면 저장하지 않는다 */
      var cur = PRICE[pid] || {};
      var body = { sell: cur.sell != null ? cur.sell : priceOf(p), margin_pct: cur.margin_pct != null ? cur.margin_pct : null, at: nowStr(), by: '사장님' };
      if (v !== courBase(p)) { body.cour = v; body.cour_by = '사장님'; }
      var s = settle(body.sell, p.buy, v);
      if (s) body.margin_pct = s.pct;
      api(R + 'price/' + encodeURIComponent(pid), { method: 'PUT', body: JSON.stringify(body) })
        .then(function () {
          PRICE[pid] = body;
          toast('🚚 ' + pid + ' 배송비 ' + won(v) + ' 저장 — 모든 기기·대행자 화면에 반영');
          if (window.v2Repaint) window.v2Repaint(pid);
        }, function () { toast('❌ 배송비 저장 실패 — 카드의 배송비 칸으로 다시 시도해 주세요'); });
    };
  })();

  function v2aHtml(p) {
    var price = priceOf(p), buy = p.buy, cour = courOf(p);
    if (!polOK()) return '<div class="cmpnote none">※ 정책 상수를 불러오지 못했습니다 — 숫자를 지어내지 않습니다. 새로고침해 주세요.</div>';
    var s = settle(price, buy, cour);
    var head = cmpNote(p) + cmpTable(p, price) + cmpSum(p, price);
    if (!s) return head + '<div class="cmpnote none">※ 매입가가 없어 정산을 계산할 수 없습니다. (지어낸 값 없음)</div>';
    var pr = PRICE[p.pid];
    var b = (p.judge || {}).boundary;
    return head +
      '<div class="shipbox" id="v2ship_' + p.pid + '">' + shipHtml(s) + '</div>' +
      calcRow(p, s) +
      '<div id="v2warn_' + p.pid + '">' + warnHtml(s) + '</div>' +
      '<div class="ledger" id="v2led_' + p.pid + '">' + ledHtml(s) + '</div>' +
      '<div class="netband' + (s.net <= 0 ? ' bad' : '') + '" id="v2net_' + p.pid + '">' + netHtml(s) + '</div>' +
      /* 누가 정했는지 그대로 표시한다 — 사장님이 안 만진 값을 '사장님이 정한 값'으로 쓰면 안 된다 */
      (pr ? '<div class="pricelog">✏️ ' + esc(pr.by || '사장님') + ' 지정 · ' + esc(pr.at || '') +
        (pr.cour != null ? ' · 배송비 ' + won(pr.cour) + ' <b>직접 지정</b>(원래 ' + won(courBase(p)) + ')' : '') + '</div>' : '') +
      (b ? '<div class="bdline">⚖️ <b>19,800원 ' + (b.better === 'A' ? '미만' : '이상') + ' 책정이 유리 (+' + b.diff_pp + '%p)</b>' +
        ' — ' + won(b.a_price) + ' → 마진 ' + b.a_pct + '% vs ' + won(b.b_price) + ' → ' + b.b_pct + '%</div>' : '');
  }

  /* 저장 뒤 그 카드만 제자리에서 다시 그린다 — 전체 재렌더는 스크롤이 튀고 다른 카드 입력이 날아간다 */
  window.v2Repaint = function (pid) {
    var p = PMAP[pid]; if (!p) return;
    var box = document.getElementById('v2a_' + pid); if (!box) return;
    box.innerHTML = v2aInner(p);
  };

  function cfHtml(p) {                             /* 확정 줄 + 버튼 */
    var c = CF[p.pid], can = hasKey();
    var btn = can ? '<span class="cfbtn">' +
      ['GO', 'HOLD', 'NOGO'].map(function (v) {
        return '<button class="cb ' + VD[v][0] + (c && c.verdict === v ? ' on' : '') +
          '" onclick="jbSet(\'' + p.pid + '\',\'' + v + '\')">' + VD[v][1] + ' 확정</button>';
      }).join('') + (c ? '<button class="cb x" onclick="jbClear(\'' + p.pid + '\')">↩ 취소</button>' : '') + '</span>' : '';
    var line = c
      ? '<span class="cfok ' + VD[c.verdict][0] + '">✅ 사장님 확정: ' + VD[c.verdict][1] + '</span>' +
      '<span class="cfat">' + esc(c.at || '') + '</span>'
      : '<span class="cfwait">⏳ 사장님 확정 대기</span>';
    return '<div class="cfrow">' + line + btn + '</div>';
  }

  /* .v2a 안쪽만 따로 뽑아 둔다 — 저장 후 이 부분만 다시 그리기 위해서다 */
  function v2aInner(p) {
    var j = p.judge || {}, v = VD[j.verdict];
    if (!v) return '<div class="jbadge wait">⚪ 조사 대기</div>' +
      '<div class="jwhy">아직 테무 조사를 하지 않은 품목입니다. (지어낸 값 없음)</div>' + cfHtml(p) + v2aHtml(p);
    var rs = (j.reason || '').replace(/\s+/g, ' ');
    var why = (j.verdict !== 'GO' && rs) ? esc(rs.length > 150 ? rs.slice(0, 150) + '…' : rs) : '';
    var d = j.researched_at;
    return '<div class="jbadge ' + v[0] + '">🤖 제안: ' + v[1] + (d ? '<span class="jdate">' + esc(d) + ' 조사</span>' : '') + '</div>' +
      (why ? '<div class="jwhy">' + why + '</div>' : '') + cfHtml(p) + v2aHtml(p);
  }

  function badgeHtml(p) {
    PMAP[p.pid] = p;
    return '<div class="v2a" id="v2a_' + p.pid + '">' + v2aInner(p) + '</div>';
  }

  /* ── 옵션 목록 (엑셀에서 온 다행 옵션 상품) ── */
  function optHtml(p) {
    var o = p.options;
    if (!o || !o.length) return '';
    var lo = Math.min.apply(null, o.map(function (x) { return x.buy; }));
    var hi = Math.max.apply(null, o.map(function (x) { return x.buy; }));
    return '<details class="optbox"><summary class="optsum">▸ 옵션 ' + o.length + '종 · 공급가 ' +
      won(lo) + (hi !== lo ? '~' + won(hi) : '') + ' (눌러서 보기)</summary><div class="optlist">' +
      o.map(function (x) {
        return '<div class="optrow"><span class="o">' + esc(x.opt) + '</span>' +
          (x.stock ? '<span class="st">' + esc(x.stock) + '</span>' : '') +
          (x.event ? '<span class="ev">행사 ' + won(x.event) + '</span>' : '') +
          '<span class="p">' + won(x.buy) + '</span></div>';
      }).join('') + '</div></details>';
  }

  /* ── 카드 썸네일: 엑셀에서 뽑은 정사각 이미지(imgData) 우선 ── */
  function withImg(h, p) {
    if (!p.imgData) return h;
    return h.replace(/<div class="thumb">[\s\S]*?<\/div>/,
      '<div class="thumb sq"><img src="' + p.imgData + '" alt=""></div>');
  }

  /* ── 카드 위쪽의 옛 계산 줄 제거 ──
     v1 의 손익분기·추천 판매가는 거래처 택배원가를 안 넣은 값이라 V2-A 명세와 숫자가 어긋난다.
     한 카드에 서로 다른 숫자가 두 벌 뜨면 안 되므로, 정산은 V2-A 한 곳만 남긴다.
     (매입가 줄은 원가 정보라 그대로 둔다) */
  function fixNums(h, p) {
    if (!p.judge) return h;
    h = h.replace(/<div class="prow"><span class="lbl">손익분기<\/span><span>[^<]*<\/span><\/div>/, '');
    h = h.replace(/<div class="prow"[^>]*><span class="lbl">추천 판매가[\s\S]*?<\/div>/, '');
    return h;
  }

  var _prev = window.pcardHtml;
  if (typeof _prev === 'function') {
    window.pcardHtml = function (p) {
      var h = _prev(p);
      if (!p) return h;
      h = fixNums(withImg(h, p), p);
      var i = h.lastIndexOf('</div></div>');            /* pbody 닫기 직전 */
      return i < 0 ? h : h.slice(0, i) + optHtml(p) + badgeHtml(p) + h.slice(i);
    };
  }

  /* ── 필터 3종: 전체 / 확정 GO / 확정 대기 ── */
  window.__jf = 'all';
  function pass(p) {
    var c = CF[p.pid];
    if (window.__jf === 'goconf') return !!(c && c.verdict === 'GO');
    if (window.__jf === 'pending') return !c && !!(p.judge && p.judge.verdict);
    return true;
  }
  var _grid = window.gridFor;
  if (typeof _grid === 'function') {
    window.gridFor = function (arr) {
      arr = arr || [];
      if (window.__jf === 'all') return _grid(arr);
      var f = arr.filter(pass);
      if (!f.length) return '<div class="a2empty" style="grid-column:1/-1">해당하는 품목이 없습니다. (전체를 누르면 다 보입니다)</div>';
      return _grid(f);
    };
  }
  window.setJF = function (m) {
    window.__jf = m;
    if (window.__reopenSup) window.__reopenSup();
  };

  /* ========== ■3 자료실 2종 ================================= */
  var KEY = 'hd15';                                  /* 접근키: ?k=hd15 */
  function hasKey() {
    try { return ((new URLSearchParams(location.search)).get('k') || _KEY) === KEY; } catch (e) { return false; }
  }
  var MAXB = 8 * 1024 * 1024;                        /* 파일 8MB (RTDB 한계 — Storage 열리면 50MB) */
  var OKEXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'xlsx', 'xls', 'csv', 'pdf', 'zip'];
  var ICON = { xlsx: '📊', xls: '📊', csv: '📊', pdf: '📕', zip: '🗜️' };
  var KIND = { src: ['제품 자료', '사장님이 넣는 원본 · 엑셀·이미지·PDF'], work: ['상세 이미지(작업물)', '대행자가 만든 썸네일·상세페이지'] };
  var _cache = {};                                   /* {vk_kind:{id:item}} */

  function ext(n) { return String(n || '').split('.').pop().toLowerCase(); }
  function fpath(vk, kind) { return R + 'files/' + vk + '/' + kind; }
  function fmtSize(b) { return b == null ? '' : (b > 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB'); }

  window.a2Load = function (vk, kind) {
    var host = document.getElementById('a2list_' + kind); if (!host) return;
    host.innerHTML = '<div class="a2empty">불러오는 중…</div>';
    api(fpath(vk, kind)).then(function (val) {
      var v = val || {}; _cache[vk + '_' + kind] = v;
      var ids = Object.keys(v).sort(function (a, b) { return (v[a].ts || 0) - (v[b].ts || 0); });
      if (!ids.length) { host.innerHTML = '<div class="a2empty">아직 파일이 없습니다. 위에 끌어다 놓으세요.</div>'; return; }
      host.innerHTML = ids.map(function (id) {
        var it = v[id], e = ext(it.name);
        var th = /^(jpg|jpeg|png|webp|gif)$/.test(e)
          ? '<img src="' + it.data + '" onclick="window.open(this.src)">'
          : '<div class="a2ico">' + (ICON[e] || '📄') + '</div>';
        return '<div class="a2row">' + th +
          '<div class="a2nm">' + esc(it.name) + '<small>' + fmtSize(it.size) + (it.from ? ' · ' + esc(it.from) : '') + '</small></div>' +
          '<div class="a2btns"><button title="다운로드" onclick="a2Dl(\'' + vk + '\',\'' + kind + '\',\'' + id + '\')">⬇</button>' +
          '<button class="del" title="삭제" onclick="a2Del(\'' + vk + '\',\'' + kind + '\',\'' + id + '\')">🗑</button></div></div>';
      }).join('');
    }).catch(function (e) { host.innerHTML = '<div class="a2empty">불러오기 실패: ' + esc(e.message) + '</div>'; });
  };

  function put(vk, kind, obj, cb) {                    /* RTDB push = POST */
    api(fpath(vk, kind), { method: 'POST', body: JSON.stringify(obj) })
      .then(function (r) { cb(r && r.error ? r.error : null); }, function (e) { cb(e.message || '실패'); });
  }

  window.a2Up = function (vk, kind, files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    var bad = files.filter(function (f) { return OKEXT.indexOf(ext(f.name)) < 0; });
    if (bad.length) { toast('❌ 허용되지 않는 형식: ' + bad.map(function (f) { return f.name; }).join(', ')); }
    files = files.filter(function (f) { return OKEXT.indexOf(ext(f.name)) >= 0; });
    var big = files.filter(function (f) { return f.size > MAXB; });
    if (big.length) { toast('❌ 8MB 초과라 못 올립니다: ' + big[0].name); }
    files = files.filter(function (f) { return f.size <= MAXB; });
    if (!files.length) return;
    var done = 0;
    files.forEach(function (f) {
      var fr = new FileReader();
      fr.onload = function () {
        var raw = fr.result;
        function save(data, size) {
          put(vk, kind, { name: f.name, data: data, size: size, ts: Date.now(), from: kind === 'src' ? '사장님' : '대행자' }, function (err) {
            done++;
            if (err) toast('❌ 업로드 실패: ' + err);
            if (done === files.length) { window.a2Load(vk, kind); toast('✅ ' + done + '개 업로드'); }
          });
        }
        if (/^(jpg|jpeg|png|webp)$/.test(ext(f.name)) && f.size > 1.2 * 1024 * 1024) {
          var im = new Image();
          im.onload = function () {                      /* 큰 사진만 1600px 로 줄여 저장 */
            var mx = 1600, w = im.width, h = im.height;
            if (w > mx || h > mx) { var sc = mx / Math.max(w, h); w = Math.round(w * sc); h = Math.round(h * sc); }
            var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(im, 0, 0, w, h);
            var d = cv.toDataURL('image/jpeg', 0.85);
            save(d, Math.round(d.length * 0.75));
          };
          im.onerror = function () { save(raw, f.size); };
          im.src = raw;
        } else save(raw, f.size);
      };
      fr.readAsDataURL(f);
    });
  };

  window.a2Del = function (vk, kind, id) {
    var it = (_cache[vk + '_' + kind] || {})[id] || {};
    if (!confirm('“' + (it.name || '이 파일') + '” 을(를) 삭제할까요?')) return;
    api(fpath(vk, kind) + '/' + id, { method: 'DELETE' }).then(function () { window.a2Load(vk, kind); toast('🗑 삭제됨'); });
  };

  window.a2Dl = function (vk, kind, id) {
    var it = (_cache[vk + '_' + kind] || {})[id]; if (!it) return;
    var a = document.createElement('a'); a.href = it.data; a.download = it.name || (id);
    document.body.appendChild(a); a.click(); a.remove();
  };

  window.a2Zip = function (vk, kind) {
    if (!window.JSZip) { toast('ZIP 라이브러리 로드 실패'); return; }
    var v = _cache[vk + '_' + kind] || {}, ids = Object.keys(v);
    if (!ids.length) { toast('받을 파일이 없습니다'); return; }
    var z = new JSZip(), used = {};
    ids.forEach(function (id) {
      var it = v[id], nm = it.name || (id + '.bin');
      while (used[nm]) nm = nm.replace(/(\.[^.]+)?$/, '_1$1');
      used[nm] = 1;
      var b64 = String(it.data || '').split(',')[1] || '';
      z.file(nm, b64, { base64: true });
    });
    z.generateAsync({ type: 'blob' }).then(function (b) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(b);
      a.download = vk + '_' + kind + '.zip'; document.body.appendChild(a); a.click(); a.remove();
      toast('⬇ ZIP ' + ids.length + '개');
    });
  };

  function secHtml(vk, kind) {
    var k = KIND[kind];
    return '<div class="a2sec' + (kind === 'work' ? ' work' : '') + '">' +
      '<div class="a2h">' + (kind === 'src' ? '📦' : '🎨') + ' ' + k[0] +
      '<span class="sub">· ' + k[1] + '</span>' +
      '<button onclick="a2Zip(\'' + vk + '\',\'' + kind + '\')">⬇ 전체 ZIP</button></div>' +
      '<div class="a2drop" ondragover="event.preventDefault();this.classList.add(\'on\')" ondragleave="this.classList.remove(\'on\')" ' +
      'ondrop="event.preventDefault();this.classList.remove(\'on\');a2Up(\'' + vk + '\',\'' + kind + '\',event.dataTransfer.files)" ' +
      'onclick="this.querySelector(\'input\').click()">여기로 <b>끌어다 놓거나</b> 클릭해서 추가' +
      '<div style="font-size:10.5px;color:#93a0a8;margin-top:3px">이미지·엑셀·PDF·ZIP · 1개 8MB 이내</div>' +
      '<input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.xlsx,.xls,.csv,.pdf,.zip" style="display:none" ' +
      'onchange="a2Up(\'' + vk + '\',\'' + kind + '\',this.files);this.value=\'\'"></div>' +
      '<div class="a2list" id="a2list_' + kind + '"></div>' +
      (kind === 'src' ? '<div id="vimggrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;margin-top:9px"></div>' : '') +
      '</div>';
  }

  /* ── openSup 뒤처리: 이미지 블록 → 자료실 2종 / GO 필터 칩 ── */
  var _open = window.openSup, _lastIdx = null;
  if (typeof _open === 'function') {
    window.openSup = function (i) {
      _lastIdx = i; _open(i);
      try { decorate(i); } catch (e) { console.log('[v3] decorate 실패', e); }
    };
    window.__reopenSup = function () { if (_lastIdx != null) window.openSup(_lastIdx); };
  }

  function decorate(i) {
    var modal = document.getElementById('modal'); if (!modal) return;
    var s = (window.DASH && window.DASH.suppliers) ? window.DASH.suppliers[i] : null; if (!s) return;
    var vk = window.wholeKey ? window.wholeKey(s.name) : String(s.name || '').replace(/\s/g, '_');
    window._a2vk = vk;

    var grid = modal.querySelector('#vimggrid');
    var host = grid ? grid.parentNode : null;
    if (host) {
      if (hasKey()) {
        host.outerHTML = '<div class="a2wrap">' + secHtml(vk, 'src') + secHtml(vk, 'work') + '</div>';
        window.a2Load(vk, 'src'); window.a2Load(vk, 'work');
        if (window.loadVimg) window.loadVimg(vk);              /* 예전에 올린 이미지도 계속 보이게 */
      } else {
        host.outerHTML = '<div class="a2lock">🔒 자료실은 <b>접근 키가 들어간 링크</b>에서만 열립니다.<br>' +
          '사장님/대행자 링크: <b>' + location.pathname + '?k=…</b> 형태로 받으신 주소로 들어오세요.</div>';
      }
    }
    var pg = modal.querySelector('#pgrid');
    if (pg) {
      var ps = s.products || [];
      var nGo = ps.filter(function (p) { return CF[p.pid] && CF[p.pid].verdict === 'GO'; }).length;
      var nPd = ps.filter(function (p) { return !CF[p.pid] && p.judge && p.judge.verdict; }).length;
      var bar = document.createElement('div');
      bar.className = 'gofilter';
      bar.innerHTML =
        '<button class="gochip' + (window.__jf === 'all' ? ' on' : '') + '" onclick="setJF(\'all\')">전체 (' + ps.length + ')</button>' +
        '<button class="gochip' + (window.__jf === 'goconf' ? ' on' : '') + '" onclick="setJF(\'goconf\')">✅ 확정 GO (' + nGo + ')</button>' +
        '<button class="gochip pd' + (window.__jf === 'pending' ? ' on' : '') + '" onclick="setJF(\'pending\')">⏳ 확정 대기 (' + nPd + ')</button>' +
        '<span class="gohint">대행자 화면에는 <b>사장님이 GO 확정한 품목만</b> 나갑니다.</span>';
      pg.parentNode.insertBefore(bar, pg);
    }
  }
  /* ── 조사값 백필 ──
     v2 의 웹소켓(SDK) 로드가 늦거나 막혀도 판정 배지는 보이게 하는 안전장치.
     REST 로 RTDB products 를 읽어 judge/selling 등 '조사 필드'만 얹는다.
     이미 들어와 있으면 아무것도 하지 않는다(덮어쓰기 없음). */
  function backfill() {
    if (!window.DASH || !window.DASH.suppliers) return;
    api(R + 'products').then(function (list) {
      if (!list) return;
      var by = {};
      list.forEach(function (p) { if (p && p.pid) by[p.pid] = p; });
      var n = 0;
      window.DASH.suppliers.forEach(function (s) {
        (s.products || []).forEach(function (p) {
          var r = by[p.pid]; if (!r) return;
          ['judge', 'temu_top3', 'unit_g', 'selling', 'assets', 'reg', 'options', 'imgData'].forEach(function (k) {
            if (r[k] != null && p[k] == null) { p[k] = r[k]; n++; }
          });
        });
      });
      if (n && typeof window.render === 'function') { try { window.render(); } catch (e) { } }
      console.log('[v3] 조사값 백필 ' + n + '건');
    }, function () { });
  }
  setTimeout(backfill, 1200); setTimeout(backfill, 6000);
  loadConfirm(false); setTimeout(function () { loadConfirm(false); }, 2500);

  /* 정본 상수·사장님 판매가 — 둘 다 들어와야 카드 숫자가 완성된다 */
  var _need = 2;
  function ready() { if (--_need <= 0 && window.__reopenSup) window.__reopenSup(); }
  api(R + 'policy').then(function (v) { POL = v || null; ready(); }, function () { ready(); });
  api(R + 'price').then(function (v) { PRICE = v || {}; ready(); }, function () { ready(); });

  console.log('[v3] 제안/확정 2단 · 배송비 정책 · 자료실 2종 로드됨 (key=' + (hasKey() ? 'ON' : 'OFF') + ')');
})();


