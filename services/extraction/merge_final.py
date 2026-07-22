#!/usr/bin/env python3
"""Merge the reviewed full-book set into /tmp/fullbook_final.json:
  - base:      /tmp/fullbook.json         (14 lessons)
  - re-run:    /tmp/rerun_soc21_23.json   (clean soc2-1, soc2-3) -> replace
  - audit:     /tmp/audit_bad.json         (claims to drop) -> remove claim + any
               question whose solution rests solely on a dropped claim
Run:  python merge_final.py
"""
import json

base = json.load(open("/tmp/fullbook.json"))
lessons = {L["lessonId"]: L for L in base["lessons"]}

# 1) swap in the clean re-run of soc2-1 / soc2-3
try:
    rer = json.load(open("/tmp/rerun_soc21_23.json"))
    for L in rer["lessons"]:
        lessons[L["lessonId"]] = L
        print(f"replaced {L['lessonId']} with clean re-run")
except FileNotFoundError:
    print("!! /tmp/rerun_soc21_23.json not found — soc2-1/soc2-3 NOT replaced")

# 2) drop audit-flagged bad claims + questions that depend only on them
bad = json.load(open("/tmp/audit_bad.json"))
dropped_c = dropped_q = 0
for lid, items in bad.items():
    badset = {i["claim_ar"] for i in items}
    L = lessons.get(lid)
    if not L:
        continue
    for s in L.get("subtopics", []):
        cl = (s.get("claims") or {}).get("claims", [])
        s["claims"]["claims"] = [c for c in cl if c["claim_ar"] not in badset]
        dropped_c += len(cl) - len(s["claims"]["claims"])
        qs = (s.get("questions") or {}).get("questions", [])
        keep = []
        for q in qs:
            steps = q.get("solution") or []
            sol_claims = {st.get("claim_ar") for st in steps if isinstance(st, dict)}
            # drop the question only if EVERY solution step rests on a bad claim
            if sol_claims and sol_claims <= badset:
                dropped_q += 1
                continue
            keep.append(q)
        s["questions"]["questions"] = keep
print(f"dropped {dropped_c} bad claims, {dropped_q} dependent questions")

out = {"lessons": [lessons[k] for k in
                   ["soc1-1","soc1-2","soc1-3","soc2-1","soc2-2","soc2-3",
                    "soc3-1","soc3-2","soc3-3","soc3-4","soc4-1","soc4-2","soc4-3","soc4-4"]]}
json.dump(out, open("/tmp/fullbook_final.json", "w"), ensure_ascii=False)
print(f"wrote /tmp/fullbook_final.json with {len(out['lessons'])} lessons")
