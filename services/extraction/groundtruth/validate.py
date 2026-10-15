"""Check book-record files against the schema and the rules the schema cannot express.

    uv run --with jsonschema python services/extraction/groundtruth/validate.py [FILE ...]

With no FILE, checks every book record under groundtruth/ (TEMPLATE.json is skipped). Exits 1 on any
problem. The schema check needs the jsonschema package; the rule checks are standard library only and
run without it.

Rules checked beyond the schema (README "Ids" and "Counting"):
- ids are unique and start with the lesson slug;
- lo, belongs_to, answer_figure and evidence point at records that exist and are of the right kind;
- a misprint's field names a field that exists on its record or part.
"""
import json
import re
import sys
from pathlib import Path

GT_DIR = Path(__file__).resolve().parent
SCHEMA = GT_DIR / "book-record.schema.json"
SKIP = {"TEMPLATE.json", "book-record.schema.json"}

FIELD_PATH = re.compile(r"^([a-z_]+)((?:\[\d+\])*)$")


def book_records():
    return [p for p in sorted(GT_DIR.rglob("*.json")) if p.name not in SKIP and "review" not in p.relative_to(GT_DIR).parts]


def resolves(rec: dict, path: str) -> bool:
    m = FIELD_PATH.match(path)
    if not m or m.group(1) not in rec:
        return False
    v = rec[m.group(1)]
    for i in re.findall(r"\[(\d+)\]", m.group(2)):
        if not isinstance(v, list) or int(i) >= len(v):
            return False
        v = v[int(i)]
    return True


def ids_of(x):
    return [] if x is None else [x] if isinstance(x, str) else list(x)


def rule_errors(d: dict) -> list[str]:
    errs = []
    slug = d.get("lesson", {}).get("slug", "")
    items = d.get("items", [])
    objs = d.get("learning_objectives", [])
    seen = {}
    for r in items + objs:
        rid = r.get("id", "")
        if rid in seen:
            errs.append(f"{rid}: duplicate id")
        seen[rid] = r
        if not rid.startswith(slug + ":"):
            errs.append(f"{rid}: id does not start with the lesson slug '{slug}:'")
    item_ids = {r["id"]: r for r in items if "id" in r}
    obj_ids = {r["id"] for r in objs if "id" in r}

    for r in items:
        rid = r.get("id", "?")
        if r.get("lo") and r["lo"] not in obj_ids:
            errs.append(f"{rid}: lo {r['lo']} is not a learning objective in this file")
        b = r.get("belongs_to")
        if b and b not in item_ids:
            errs.append(f"{rid}: belongs_to {b} is not an item in this file")
        if b == rid:
            errs.append(f"{rid}: belongs_to itself")
        for where, rec in [(rid, r)] + [(f"{rid}:{p.get('label')}", p) for p in r.get("parts", [])]:
            for f in ids_of(rec.get("answer_figure")):
                if f not in item_ids or item_ids[f].get("type") not in ("figure", "table"):
                    errs.append(f"{where}: answer_figure {f} is not a figure or table in this file")
            for m in rec.get("misprints", []):
                if not resolves(rec, m.get("field", "")):
                    errs.append(f"{where}: misprint field '{m.get('field')}' is not a field on this record")
        labels = [p.get("label") for p in r.get("parts", [])]
        if len(labels) != len(set(labels)):
            errs.append(f"{rid}: two parts share a label")

    for o in objs:
        for e in o.get("evidence", []):
            if e not in item_ids:
                errs.append(f"{o.get('id')}: evidence {e} is not an item in this file")
    orders = [o.get("order_in_parent") for o in objs]
    if len(orders) != len(set(orders)):
        errs.append("learning_objectives: two objectives share an order_in_parent")
    return errs


def main(argv: list[str]) -> int:
    files = [Path(a).resolve() for a in argv] or book_records()
    try:
        from jsonschema import Draft202012Validator
        validator = Draft202012Validator(json.loads(SCHEMA.read_text()))
    except ImportError:
        validator = None
        print("jsonschema is not installed: checking rules only. Run with `uv run --with jsonschema`.")
    bad = 0
    for p in files:
        try:
            d = json.loads(p.read_text())
        except (OSError, json.JSONDecodeError) as e:
            print(f"✗ {p.name}: {e}")
            bad += 1
            continue
        errs = []
        if validator:
            for e in sorted(validator.iter_errors(d), key=lambda e: list(e.absolute_path)):
                errs.append(f"schema: /{'/'.join(map(str, e.absolute_path))}: {e.message[:200]}")
        errs += rule_errors(d)
        rel = p.relative_to(GT_DIR) if GT_DIR in p.parents else p
        if errs:
            bad += 1
            print(f"✗ {rel}")
            for e in errs:
                print(f"    {e}")
        else:
            print(f"✓ {rel}: {len(d['items'])} items, {len(d['learning_objectives'])} objectives")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
