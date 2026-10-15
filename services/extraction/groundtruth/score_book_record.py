"""Score an extracted book record against the ground truth of the same lesson.

    python3 services/extraction/groundtruth/score_book_record.py <extraction.json> <ground-truth.json> [--json OUT]

Records are matched by id first; whatever is left is matched by type and page on the closest quote (or main text).
Per item type it reports: in the ground truth, found, missing, invented. For matched records: a different type,
different parts, a different printed answer. For misprints: which of the ground truth's the extraction proposed.

Only what a person labelled counts as truth where the file says so: records with review.status "confirmed" are
the confirmed yardstick, and the report gives both "all ground-truth records" and "confirmed only". Records the
ground truth lists in not_in_book count as invented. Standard library only.
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

MAIN = ("quote", "claim", "stem", "text", "caption", "term")


def norm(s: str) -> str:
    s = re.sub(r"\$|\\[a-zA-Z]+|[{}\\]", " ", str(s or "").lower())
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9()=,;+\-×./ ]", " ", s)).strip()


def sim(a: dict, b: dict) -> float:
    best = 0.0
    for k in MAIN:
        if a.get(k) and b.get(k):
            best = max(best, SequenceMatcher(None, norm(a[k]), norm(b[k])).ratio())
    return best


def local(rid: str) -> str:
    return rid.split(":", 1)[-1]


def match(ext: list[dict], gt: list[dict]) -> tuple[list[tuple[dict, dict, str]], list[dict], list[dict]]:
    pairs, ext_left = [], {e["id"]: e for e in ext}
    gt_left = []
    by_local = {local(e["id"]): e for e in ext}
    for g in gt:
        e = by_local.get(local(g["id"]))
        if e and e["id"] in ext_left and (e["type"] == g["type"] or sim(e, g) >= 0.5):
            pairs.append((g, e, "id"))
            del ext_left[e["id"]]
        else:
            gt_left.append(g)
    still = []
    for g in gt_left:
        cands = [e for e in ext_left.values() if abs((e.get("source_page") or 0) - (g.get("source_page") or 0)) <= 1]
        best = max(cands, key=lambda e: (sim(e, g) + (0.15 if e["type"] == g["type"] else 0)), default=None)
        if best is not None and sim(best, g) >= 0.45:
            pairs.append((g, best, "content"))
            del ext_left[best["id"]]
        else:
            still.append(g)
    return pairs, still, list(ext_left.values())


def answers_of(r: dict) -> dict[str, str]:
    """Answers compared without spacing ("(1, 2)" and "(1,2)" are the same answer)."""
    key = lambda x: norm(x).replace(" ", "")
    out = {}
    if r.get("answer"):
        out["(item)"] = key(r["answer"])
    for p in r.get("parts") or []:
        if p.get("answer"):
            out[p["label"]] = key(p["answer"])
    return out


def score(ext_doc: dict, gt_doc: dict) -> dict:
    ext = [r for r in ext_doc.get("items") or []]
    gt_all = [r for r in gt_doc.get("items") or []]
    confirmed = {r["id"] for r in gt_all if (r.get("review") or {}).get("status") == "confirmed"}
    pairs, missing, invented = match(ext, gt_all)
    invented_ids = {n["id"] for n in gt_doc.get("not_in_book") or []}
    rows = defaultdict(Counter)
    for g, e, how in pairs:
        rows[g["type"]]["truth"] += 1
        rows[g["type"]]["found"] += 1
        rows[g["type"]]["same id"] += how == "id" and local(g["id"]) == local(e["id"])
        rows[g["type"]]["type differs"] += g["type"] != e["type"]
    for g in missing:
        rows[g["type"]]["truth"] += 1
        rows[g["type"]]["missing"] += 1
    for e in invented:
        rows[e["type"]]["invented"] += 1
    details = {"matched": [], "missing": [], "invented": []}
    for g, e, how in pairs:
        d = {"truth": g["id"], "extraction": e["id"], "how": how, "confirmed": g["id"] in confirmed}
        if g["type"] != e["type"]:
            d["type"] = [g["type"], e["type"]]
        gl, el = [p["label"] for p in g.get("parts") or []], [p["label"] for p in e.get("parts") or []]
        if gl != el:
            d["parts"] = [gl, el]
        ga, ea = answers_of(g), answers_of(e)
        diff = {k: [ga.get(k), ea.get(k)] for k in set(ga) | set(ea) if ga.get(k) != ea.get(k)}
        if diff:
            d["answers"] = diff
        details["matched"].append(d)
    details["missing"] = [{"id": g["id"], "type": g["type"], "page": g.get("source_page"), "quote": g.get("quote"),
                           "confirmed": g["id"] in confirmed} for g in missing]
    details["invented"] = [{"id": e["id"], "type": e["type"], "page": e.get("source_page"), "quote": e.get("quote"),
                            "labelled_not_in_book": e["id"] in invented_ids} for e in invented]
    # misprints the ground truth records, and whether the extraction proposed them
    mp = []
    pair_of = {g["id"]: e for g, e, _ in pairs}
    for g in gt_all:
        for holder in [g] + list(g.get("parts") or []):
            for m in holder.get("misprints") or []:
                e = pair_of.get(g["id"])
                found = False
                if e:
                    for eh in [e] + list(e.get("parts") or []):
                        for em in eh.get("misprints") or []:
                            if SequenceMatcher(None, norm(em.get("printed")), norm(m["printed"])).ratio() >= 0.6:
                                found = True
                mp.append({"record": g["id"], "printed": m["printed"], "intended": m["intended"], "found": found})
    ext_mp = sum(len(h.get("misprints") or []) for r in ext for h in [r] + list(r.get("parts") or []))
    t = sum(r["truth"] for r in rows.values())
    f = sum(r["found"] for r in rows.values())
    inv = sum(r["invented"] for r in rows.values())
    conf_found = sum(1 for d in details["matched"] if d["confirmed"])
    return {
        "lesson": gt_doc["lesson"]["slug"],
        "recall": round(f / t, 3) if t else None,
        "precision": round(f / (f + inv), 3) if f + inv else None,
        "confirmed_recall": round(conf_found / len(confirmed), 3) if confirmed else None,
        "by_type": {k: dict(v) for k, v in sorted(rows.items())},
        "objectives": {"truth": len(gt_doc.get("learning_objectives") or []), "extraction": len(ext_doc.get("learning_objectives") or [])},
        "misprints": {"truth": len(mp), "found": sum(m["found"] for m in mp), "extraction_proposed": ext_mp, "list": mp},
        "details": details,
    }


def report(s: dict) -> str:
    out = [f"# {s['lesson']}: extraction vs ground truth", "",
           f"Found {s['recall']:.0%} of the ground truth's records (confirmed records only: "
           f"{s['confirmed_recall']:.0%}); {s['precision']:.0%} of what the extraction recorded matches a ground-truth record.",
           "", "| type | truth | found | missing | invented | type differs | same id |", "|---|---|---|---|---|---|---|"]
    for k, v in s["by_type"].items():
        out.append(f"| {k} | {v.get('truth', 0)} | {v.get('found', 0)} | {v.get('missing', 0)} | {v.get('invented', 0)} | "
                   f"{v.get('type differs', 0)} | {v.get('same id', 0)} |")
    m = s["misprints"]
    out += ["", f"Objectives: {s['objectives']['truth']} in the ground truth, {s['objectives']['extraction']} extracted.",
            f"Misprints: the extraction proposed {m['found']} of the ground truth's {m['truth']}, and {m['extraction_proposed']} in all."]
    for x in m["list"]:
        out.append(f"- {'✓' if x['found'] else '✗'} {x['record']}: {x['printed']} → {x['intended']}")
    d = s["details"]
    if d["missing"]:
        out += ["", "Missing (in the ground truth, not extracted):"] + [f"- {x['id']} ({x['type']}, p.{x['page']}) “{(x['quote'] or '')[:60]}”" for x in d["missing"]]
    if d["invented"]:
        out += ["", "Extracted but not in the ground truth:"] + [f"- {x['id']} ({x['type']}, p.{x['page']}) “{(x['quote'] or '')[:60]}”" for x in d["invented"]]
    diffs = [x for x in d["matched"] if any(k in x for k in ("type", "parts", "answers"))]
    if diffs:
        out += ["", "Matched, but different:"]
        for x in diffs:
            bits = [f"type {x['type'][0]} → {x['type'][1]}" if "type" in x else "",
                    f"parts {x['parts'][0]} → {x['parts'][1]}" if "parts" in x else "",
                    f"answers {x['answers']}" if "answers" in x else ""]
            out.append(f"- {x['truth']} ~ {x['extraction']}: " + "; ".join(b for b in bits if b))
    return "\n".join(out)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("extraction", type=Path)
    ap.add_argument("truth", type=Path)
    ap.add_argument("--json", type=Path)
    a = ap.parse_args(argv)
    s = score(json.loads(a.extraction.read_text()), json.loads(a.truth.read_text()))
    print(report(s))
    if a.json:
        a.json.write_text(json.dumps(s, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
