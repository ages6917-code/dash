# -*- coding: utf-8 -*-
r"""
위탁 대시보드 데이터 → RTDB 시드 (단일 소스화)
─────────────────────────────────────────────
왜: 지금까지 거래처/제품이 wholesale.html에 하드코딩(4곳)돼 있고,
    노트북 _데이터소스\vendors.json(6곳)·products.json(78개)와 따로 놀았다.
    → RTDB shared/wholesale/{vendors,products} 를 단일 소스로 만들어
      데스크톱·노트북·모바일이 같은 데이터를 본다(요구 5번 동기화).

원칙(데이터 진실성): 지어내지 않는다.
 - 택배 마감시간(shipDeadline)은 note에 묻혀 있던 것을 '제안값'으로만 뽑고,
   확정이 아니면 빈칸으로 둔다. 화면에서 사장님이 확정 입력.
 - 마진은 저장하지 않는다(매입가·판매가에서 화면이 계산). 원본 왜곡 금지.

실행: python -X utf8 _wholesale_seed.py [--dry]
"""
import json, re, sys, urllib.request, os

SRC = r"C:\Users\User\Desktop\OneDrive\노트북\ttapp\위탁판매 거래처 수집\_데이터소스"
RTDB = "https://consult-crm-cfef6-default-rtdb.asia-southeast1.firebasedatabase.app"
DRY = "--dry" in sys.argv


def load(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return json.load(f)


def clean(v):
    """'None' 문자열·빈문자 → None 정규화 (원본 오염 방지)"""
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        if s in ("", "None", "null", "nan"):
            return None
        return s
    return v


def num(v):
    v = clean(v)
    if v is None:
        return None
    try:
        return int(float(str(v).replace(",", "")))
    except Exception:
        return None


# note 안에 묻힌 택배 마감시간 '후보'만 추출 (확정 아님 → 화면에서 사장님 확정)
DEADLINE_PAT = re.compile(r"((?:오전|오후|낮|밤)?\s*\d{1,2}\s*시\s*마감|\d{1,2}:\d{2}\s*마감|마감\s*\d{1,2}\s*시)")


def guess_deadline(note):
    if not note:
        return ""
    m = DEADLINE_PAT.search(note)
    return m.group(1).strip() if m else ""


vendors_raw = load("vendors.json")
products_raw = load("products.json")

vendors, products = [], []
for v in vendors_raw:
    note = clean(v.get("note")) or ""
    vendors.append({
        "id": v.get("id"),
        "name": clean(v.get("name")) or "",
        "cat": clean(v.get("cat")) or "",
        "emoji": clean(v.get("emoji")) or "📦",
        "status": clean(v.get("status")) or "ok",
        "phone": clean(v.get("phone")) or "",
        "email": clean(v.get("email")) or "",
        "region": clean(v.get("region")) or "",
        "card": clean(v.get("card")) or "",
        "note": note,
        "vatIncluded": v.get("vatIncluded") if isinstance(v.get("vatIncluded"), bool) else None,
        "shipPolicy": v.get("shipPolicy") if isinstance(v.get("shipPolicy"), dict) else None,
        # ★신규 필드 — 요구 2번(택배 마감시간)
        "shipDeadline": "",                    # 확정값(사장님이 화면에서 입력)
        "shipDeadlineGuess": guess_deadline(note),  # note에서 뽑은 후보(참고용, 확정 아님)
    })

for p in products_raw:
    products.append({
        "pid": p.get("pid"),
        "vendorId": p.get("vendorId"),
        "g": clean(p.get("g")) or "전체",
        "name": clean(p.get("name")) or "",
        "spec": clean(p.get("spec")) or "",
        "buy": num(p.get("buy")),
        "ship": num(p.get("ship")) or 0,
        "sell": num(p.get("sell")),
        "mkt": clean(p.get("mkt")) or "",
        "emoji": clean(p.get("emoji")) or "📦",
        "note": clean(p.get("note")) or "",
        "origin": clean(p.get("origin")) or "",
        "img": clean(p.get("img")) or "",
    })

# 실측 요약
withsell = sum(1 for p in products if p["sell"] is not None)
withbuy = sum(1 for p in products if p["buy"] is not None)
guessed = [(v["name"], v["shipDeadlineGuess"]) for v in vendors if v["shipDeadlineGuess"]]
print(f"거래처 {len(vendors)}곳 / 제품 {len(products)}개")
print(f"  판매가 있음 {withsell}/{len(products)} · 매입가 있음 {withbuy}/{len(products)}")
print(f"  마감시간 후보 발견 {len(guessed)}곳: {guessed}")
print(f"  마감시간 미상 {len(vendors)-len(guessed)}곳 → 화면에서 입력 필요")

if DRY:
    print("\n[--dry] 업로드 안 함")
    sys.exit(0)


def put(path, obj):
    req = urllib.request.Request(f"{RTDB}/{path}.json", method="PUT",
                                 data=json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


print("\nRTDB 업로드…")
print("  vendors :", put("shared/wholesale/vendors", vendors))
print("  products:", put("shared/wholesale/products", products))
print("  meta/updated:", put("shared/wholesale/dataUpdated", "2026-07-15"))
print("DONE — shared/wholesale/{vendors,products} 단일 소스 게시 완료")
