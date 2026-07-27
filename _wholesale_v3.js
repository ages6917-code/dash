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

  /* 근거 1줄 — 실측·계산값만. 없으면 만들어내지 않는다. */
  function whyLine(p) {
    var j = p.judge || {}, t = (p.temu_top3 && p.temu_top3.length) ? p.temu_top3[0] : null, out = [];
    if (t) out.push('테무 1위 <b>' + won(t.price) + '</b>' + (t.qty_g ? '(' + t.qty_g + 'g)' : '') +
      (t.sales != null ? '·판매 ' + Number(t.sales).toLocaleString() : ''));
    if (j.price_reco != null) out.push('우리 추천가 <b>' + won(j.price_reco) + '</b>' +
      (j.margin_pct != null ? ', 마진 ' + j.margin_pct + '%' : '') +
      (j.bep != null ? ' (손익분기 ' + won(j.bep) + ')' : ''));
    if (!out.length) return '';
    var d = j.researched_at || (t && t.researched_at);
    var s = out.join(' — ') + (d ? ' <span style="color:#9aa">(' + esc(d) + ' 조사)</span>' : '');
    /* ■2 배송비 표기 — 실질 부담을 숨기지 않는다 */
    if (j.ship_real != null) {
      s += '<div class="shipline">🚚 실질 배송 부담 <b>' + (j.ship_real < 0
        ? '없음 (+' + won(-j.ship_real) + ' 남음)' : won(j.ship_real)) + '</b>' +
        ' — 택배원가 ' + won(j.courier) +
        (j.price_reco != null && j.price_reco < 19800 ? ' · 고객 3,000원 수취' : ' · 무료배송(수취 없음)') + '</div>';
    }
    var b = j.boundary;
    if (b) {
      s += '<div class="bdline">⚖️ <b>19,800원 ' + (b.better === 'A' ? '미만' : '이상') + ' 책정이 유리 (+' + b.diff_pp + '%p)</b>' +
        ' — ' + won(b.a_price) + ' → 마진 ' + b.a_pct + '% vs ' + won(b.b_price) + ' → ' + b.b_pct + '%</div>';
    }
    return s;
  }

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

  function badgeHtml(p) {
    var v = p.judge && VD[p.judge.verdict];
    if (!v) return '<div class="jbadge wait">⚪ 조사 대기</div>' +
      '<div class="jwhy">아직 테무 조사를 하지 않은 품목입니다. (지어낸 값 없음)</div>' + cfHtml(p);
    var why = whyLine(p);
    var rs = (p.judge.reason || '').replace(/\s+/g, ' ');
    if (p.judge.verdict !== 'GO' && rs) why = (why ? why + '<br>' : '') + esc(rs.length > 140 ? rs.slice(0, 140) + '…' : rs);
    return '<div class="jbadge ' + v[0] + '">🤖 제안: ' + v[1] + '</div>' +
      (why ? '<div class="jwhy">' + why + '</div>' : '') + cfHtml(p);
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

  /* ── 카드 위쪽 숫자를 새 배송비 정책 값으로 교체 ──
     원본(v1) 계산은 거래처 택배원가를 안 넣어서 손익분기·마진이 낙관적으로 나온다.
     한 카드에 서로 다른 숫자가 두 개 뜨면 안 되므로 정책 계산값 하나로 통일한다. */
  function fixNums(h, p) {
    var j = p.judge || {};
    if (j.bep != null) h = h.replace(/(<span class="lbl">손익분기<\/span><span>)[^<]*(<\/span>)/, '$1' + won(j.bep) + '$2');
    if (j.price_reco != null) {
      h = h.replace(/(<span class="lbl">추천 판매가\s*)<b[^>]*>[^<]*<\/b>/,
        '$1<b style="color:#1b8f5a">·마진' + (j.margin_pct != null ? j.margin_pct + '%' : '–') + '</b>');
      h = h.replace(/(<span class="sell">)[^<]*(<\/span>)/, '$1' + won(j.price_reco) + '$2');
    }
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

  console.log('[v3] 제안/확정 2단 · 배송비 정책 · 자료실 2종 로드됨 (key=' + (hasKey() ? 'ON' : 'OFF') + ')');
})();


