#!/usr/bin/env python3
"""Debug lỗi 400: POST từng dataSpec của dashboard mặc định tới /studio/query.
Chạy: cd /home/user/qlbv && python3 .ai/examples/debug-query400.py"""
import json, urllib.request

BASE = "http://localhost:4000/api"

def req(method, path, token=None, body=None):
    r = urllib.request.Request(BASE + path, method=method)
    r.add_header("content-type", "application/json")
    if token:
        r.add_header("authorization", "Bearer " + token)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    try:
        with urllib.request.urlopen(r, data=data) as resp:
            out = json.loads(resp.read().decode("utf-8"))
            if isinstance(out, dict) and "data" in out and "success" in out:
                return resp.status, out["data"]
            return resp.status, out
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw

status, login = req("POST", "/auth/login", body={"username": "admin", "password": "Admin@123"})
if status != 201 and status != 200:
    print("LOGIN FAIL", status, json.dumps(login)[:200]); raise SystemExit(1)
token = login["accessToken"]

status, page = req("GET", "/studio/pages/default?kind=DASHBOARD", token)
print("GET default:", status)
print("== layout items ==")
layout = page.get("layout", {})
items = layout.get("widgets", layout) if isinstance(layout, dict) else layout
fails = 0
for i, item in enumerate(items):
    spec = item.get("dataSpec")
    print(f"\n[{i}] widget={item.get('widgetType')} title={item.get('title')!r}")
    print("  spec:", json.dumps(spec, ensure_ascii=False)[:150])
    if not spec:
        print("  (không có dataSpec)"); continue
    code, resp = req("POST", "/studio/query", token, body=spec)
    if code in (200, 201):
        print("  OK (spec trực tiếp) ->", json.dumps(resp.get("data") or resp, ensure_ascii=False)[:100])
    else:
        # Thử gói trong {dataSpec: spec} / {spec: spec} để chẩn đoán
        code2, resp2 = req("POST", "/studio/query", token, body={"dataSpec": spec})
        code3, resp3 = req("POST", "/studio/query", token, body={"spec": spec})
        print(f"  ❌ trực tiếp {code}: {json.dumps(resp, ensure_ascii=False)[:150]}")
        print(f"     {{dataSpec}} {code2}: {json.dumps(resp2, ensure_ascii=False)[:120]}")
        print(f"     {{spec}}    {code3}: {json.dumps(resp3, ensure_ascii=False)[:120]}")
        fails += 1

print(f"\n== Kết luận: {fails} widget lỗi ==")
