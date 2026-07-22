#!/usr/bin/env python3
"""Assemble the full rich Social-Studies Term-1 book into:
  - seed/social-t1.json         (SeedBundle: nodes, edges, questions, visuals)
  - seed/content/<lessonId>.json (rich lesson_content for the frontend surface)

Input: /tmp/fullbook_final.json  (14 merged, reviewed lessons from the rich pipeline).
Validates the bundle with the real Pydantic SeedBundle before writing.
"""
import json, os, re, collections
from schemas import SeedBundle

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MAPS = os.path.join(ROOT, "app", "public", "maps")
SEED = os.path.join(os.path.dirname(__file__), "seed")
CONTENT = os.path.join(SEED, "content")
os.makedirs(CONTENT, exist_ok=True)

COURSE = "course:prep3-social-ar"
UNITS = {
    "u1": ("module:soc-t1-u1", "الوحدة الأولى — الجغرافيا الطبيعية للعالم", "topic:geography-social"),
    "u2": ("module:soc-t1-u2", "الوحدة الثانية — جغرافية سكان العالم", "topic:geography-social"),
    "u3": ("module:soc-t1-u3", "الوحدة الثالثة — مصر تحت الحكم العثماني", "topic:history"),
    "u4": ("module:soc-t1-u4", "الوحدة الرابعة — مصر والزحف الاستعماري ومحاولات التحرر الوطني", "topic:history"),
}
def unit_of(lesson_id):   # soc1-3 -> u1
    return "u" + lesson_id[3]

# ---- source-doc: reuse the existing social document ----
SOURCE_FILE = "docs/Source/Social_prp3_T1_2.pdf"

def load_gaz(base):
    p = os.path.join(MAPS, f"{base}.json")
    if not os.path.exists(p): return None
    return set(json.load(open(p))["places"].keys())

GAZ = {}

def _label(d, *keys):
    for k in keys:
        val = d.get(k)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""

def _norm_events(spec):
    """Renderer wants events:[{label, when?, step}]. Agents used events|items,
    label|label_ar|title, step|order — normalize to the contract."""
    raw = spec.get("events") or spec.get("items") or []
    out = []
    for i, e in enumerate(raw):
        if isinstance(e, str) and e.strip():
            out.append({"label": e.strip(), "step": i + 1}); continue
        if not isinstance(e, dict): continue
        label = _label(e, "label", "label_ar", "title", "title_ar", "text")
        if not label: continue
        ev = {"label": label, "step": e.get("step") or e.get("order") or i + 1}
        when = _label(e, "when", "date", "at", "year")
        if when: ev["when"] = when
        out.append(ev)
    return out

def _norm_nodes(spec):
    """Renderer wants nodes:[{id,label,role?,step}]. Agents used
    nodes|steps|chain|chains, label|label_ar, step|order, role|role_ar."""
    raw = spec.get("nodes") or spec.get("steps") or spec.get("chain") or []
    if not raw and isinstance(spec.get("chains"), list):
        for c in spec["chains"]:
            if isinstance(c, list): raw += c
            elif isinstance(c, dict): raw.append(c)
    out = []
    for i, n in enumerate(raw):
        if isinstance(n, str) and n.strip():
            out.append({"id": str(i), "label": n.strip(), "step": i + 1}); continue
        if not isinstance(n, dict): continue
        label = _label(n, "label", "label_ar", "title", "title_ar", "text")
        if not label: continue
        nd = {"id": str(n.get("id", i)), "label": label,
              "step": n.get("step") or n.get("order") or i + 1}
        role = _label(n, "role", "role_ar")
        if role: nd["role"] = role
        out.append(nd)
    return out

def valid_visual(v):
    """Keep only visuals whose spec matches the RENDERER contract (normalized)."""
    spec = v.get("spec") or {}
    kind = v.get("kind")
    if kind not in ("map_scene", "timeline", "flow_chain"): return None
    if kind == "map_scene":
        base = spec.get("base")
        if base not in GAZ:
            GAZ[base] = load_gaz(base) if base else None
        places = GAZ.get(base)
        if not places: return None
        marks = [m for m in (spec.get("marks") or []) if m.get("place") in places]
        if len(marks) < 2: return None
        spec["marks"] = marks
    elif kind == "timeline":
        events = _norm_events(spec)
        if len(events) < 2: return None
        v["spec"] = {"events": events, "animate": spec.get("animate", "sequence"),
                     **({"era": spec["era"]} if isinstance(spec.get("era"), list) else {})}
    elif kind == "flow_chain":
        nodes = _norm_nodes(spec)
        if len(nodes) < 2: return None
        keep = {"nodes": nodes, "animate": spec.get("animate", "sequence")}
        if spec.get("links"): keep["links"] = spec["links"]
        v["spec"] = keep
    return v

def main():
    data = json.load(open("/tmp/fullbook_final.json"))
    lessons = {L["lessonId"]: L for L in data["lessons"]}
    ORDER = ["soc1-1","soc1-2","soc1-3","soc2-1","soc2-2","soc2-3",
             "soc3-1","soc3-2","soc3-3","soc3-4","soc4-1","soc4-2","soc4-3","soc4-4"]

    nodes = [{"id": COURSE, "kind": "course", "label": "الدراسات الاجتماعية — الصف الثالث الإعدادي", "order_in_parent": 2}]
    nodes.append({"id": "topic:geography-social", "kind": "topic", "label": "الجغرافيا"})
    nodes.append({"id": "topic:history", "kind": "topic", "label": "التاريخ"})
    edges, questions, visuals = [], [], []
    seen_units = set()
    stats = collections.Counter()

    for order, lid in enumerate(ORDER, 1):
        L = lessons.get(lid)
        if not L:
            print(f"!! MISSING lesson {lid}"); continue
        uk = unit_of(lid); mod_id, mod_label, topic = UNITS[uk]
        if mod_id not in seen_units:
            seen_units.add(mod_id)
            nodes.append({"id": mod_id, "kind": "module", "label": mod_label, "order_in_parent": int(uk[1])})
            edges.append({"src": mod_id, "dst": COURSE, "type": "part_of"})

        # LO nodes from the objectives box (verbatim)
        objs = L.get("objectives") or []
        lo_ids = []
        for o in objs:
            n = o["n"]; lo_id = f"lo:{lid}-{n}"
            lo_ids.append((n, lo_id))
            nodes.append({"id": lo_id, "kind": "learning_objective",
                          "label": o["text"].strip().rstrip("."),
                          "description": o["text"].strip(),
                          "order_in_parent": n})
            edges.append({"src": mod_id, "dst": lo_id, "type": "teaches"})
            edges.append({"src": lo_id, "dst": topic, "type": "about"})
        # intra-lesson prerequisite chain (keeps the DAG layered)
        ordered = [lid_ for _, lid_ in sorted(lo_ids)]
        for a, b in zip(ordered, ordered[1:]):
            edges.append({"src": a, "dst": b, "type": "prerequisite_of"})
        lo_set = {lid_ for _, lid_ in lo_ids}

        def lo_ref(lo_n):
            r = f"lo:{lid}-{lo_n}"
            return r if r in lo_set else (ordered[0] if ordered else None)

        # questions
        for s in (L.get("subtopics") or []):
            qs = (s.get("questions") or {}).get("questions", [])
            ans_ok = {}
            for vv in (s.get("verify") or {}).get("verdicts", []):
                ans_ok[vv["id"]] = str(vv.get("my_answer", "")).strip()
            for q in qs:
                lo = lo_ref(q.get("lo_n"))
                if not lo: continue
                a = str(q.get("answer", "")).strip()
                my = ans_ok.get(q["id"], "")
                verified = bool(q.get("type") == "mcq" and a and my and a[:1].lower() == my[:1].lower())
                qd = {"id": q["id"], "lo": lo, "tier": q["tier"],
                      "type": q["type"] if q["type"] in ("mcq","short","numeric") else "short",
                      "stem": q["stem"], "answer": q["answer"],
                      "solution": q["solution"] if q.get("solution") else [
                          {"claim_ar": q["stem"], "evidence_page": q.get("source_page", 1), "evidence_kind": "text"}],
                      "source_page": q.get("source_page", 1),
                      "source_note": f"style={q.get('style','?')} · {lid}",
                      "verified": verified}
                if q.get("choices"): qd["choices"] = q["choices"]
                questions.append(qd); stats["q"] += 1; stats["q_verified"] += verified

        # visuals (bundle-loadable subset)
        wv = (L.get("widgets") or {}).get("visuals", [])
        for i, v in enumerate(wv, 1):
            lo = lo_ref(v.get("lo_n"))
            if not lo: continue
            vv = valid_visual({"id": f"v:{lid}:{i:02d}", "lo": lo, "question": None,
                               "kind": v["kind"], "spec": v.get("spec") or {},
                               "caption": v.get("caption"), "source_page": v.get("source_page")})
            if vv: visuals.append(vv); stats["viz"] += 1

        # ---- lesson_content for the frontend surface ----
        content = {
            "lessonId": lid, "title": L.get("title"),
            "tamheed": L.get("tamheed"),
            "subtopics": [{"key": s.get("key"), "title": s.get("title"),
                           "exposition": (s.get("claims") or {}).get("exposition", "")}
                          for s in (L.get("subtopics") or [])],
            "key_terms": [{"term_ar": t["term_ar"], "definition_ar": t["definition_ar"]}
                          for t in (L.get("key_terms") or [])],
            "enrichment": [{"title": e["title"], "body_ar": e["body_ar"]}
                           for e in (L.get("enrichment") or [])],
            "misconceptions": [{"wrong": m["wrong"], "correction": m["correction"]}
                               for m in (L.get("misconceptions") or [])],
            "interactives": [{"lo": lo_ref(it.get("lo_n")), "kind": it["kind"],
                              "prompt_ar": it.get("prompt_ar", ""), "spec": it.get("spec") or {}}
                             for it in (L.get("widgets") or {}).get("interactives", [])],
        }
        json.dump(content, open(os.path.join(CONTENT, f"{lid}.json"), "w"), ensure_ascii=False, indent=1)
        stats["content_files"] += 1

    bundle = {
        "source_file": SOURCE_FILE,
        "extraction_run": {"extractor": "rich-lesson workflow (Phase B, full book, reviewed)",
                           "extractor_version": "pipeline-2", "schema_version": "1"},
        "syllabus_version": "2025-2026",
        "nodes": nodes, "edges": edges, "questions": questions, "visuals": visuals,
        "external_node_refs": [],
    }
    SeedBundle(**bundle)  # validate or raise
    json.dump(bundle, open(os.path.join(SEED, "social-t1.json"), "w"), ensure_ascii=False, indent=1)
    print(f"✅ VALID bundle: {len(nodes)} nodes, {len(edges)} edges, "
          f"{stats['q']} questions ({stats['q_verified']} verified), {stats['viz']} visuals")
    print(f"✅ {stats['content_files']} lesson_content files written to seed/content/")

if __name__ == "__main__":
    main()
