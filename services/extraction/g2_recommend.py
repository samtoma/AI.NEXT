"""The G2 recommendation run: packet builder, validation and collector (no model is called here).

    uv run auto_pass_gates.py g2-recommend-args <book> --chapter N [--lesson-run RUN …] --embed <copy>.workflow.js
    uv run auto_pass_gates.py g2-recommend-collect <book> --chapter N [--lesson-run RUN …] --run <saved run> [--run …] \\
              --out runs/<book>/g2-chNN.recommended.json
    uv run auto_pass_gates.py g2 <book> --chapter N --lesson-run … --recommend runs/<book>/g2-chNN.recommended.json \\
              --into runs/<book>/g2-chNN.json --split          # the recommendation becomes G2's auto verdicts

WHY (Samuel's answers 37a and 42, 2026-10-01: students always full, quality first, every decision recorded for his review).
The G2 auto-pass (auto_pass_gates.py g2) decides an item on the checks' own rule: a typing problem is EXCLUDED and a
three-way disagreement is HELD with no verdict. Chapter 1's first pass: 47 held, 35 excluded of 575 items. Most are not
wrong: the printed answer and the book's worked solution agree and only the blind solver differs; or the typing check
complains about a text comparison. The Chapter 8 pilot's G2 recommendations were written per disputed item by an agent;
`runbook/g2-recommend.workflow.js` is that, as a stage: one Sonnet agent per batch of ~8 items recommends a verdict for each
(accept / fix with the book's own answer re-typed / hold / exclude, with a class, a confidence and a reason), and one independent
agent per batch of verdicts that would put a question live derives the answer itself, then judges the key. THIS MODULE is the
deterministic part on both sides of it:

  * `recommendable` / `build_args`: which items owe a recommendation (an item no human has decided, that the checks held
    with no verdict or excluded for typing; never an item the rule accepts, a teaching item, or one a person decided), in
    book order, and the packet the generated copy carries;
  * `collect`: the saved run's answers, checked, as the recommendation file `auto_pass_gates.py g2 --recommend` reads
    ({items: {key: {verdict, class, confidence, note, why_low?, fields?, stem_fix_by?}}}).

THE POLICY THE COLLECTOR ENFORCES (the workflow's prompts ask for it; nothing is trusted without it):
  * a verdict that puts a question live (accept, fix) must (1) quote a span of the item's own BOOK text (its worked solution, the
    EPUB's final answer or the printed answer): a quote the book does not contain is an ungrounded verdict; (2) leave an item the
    pipeline's own models accept (RunItem, the choice-option rules, the marker-spec rules, a numeric key that is a number, the
    options of a "stem" choice present in the stem); (3) for a fix, re-type the key from that quote, never from nowhere (the
    key's letters and digits are a subsequence of the quote's); (4) have every expression key read by THE APP'S OWN MARKER
    (marker_check.mjs: the same module the assembly runs); (5) keep a stem repair a repair (a few characters, never a
    rewrite, the [figure] marker kept); (6) be CONFIRMED by the independent verifier (it worked the stem alone and the key is
    right and no other answer is also right). Anything that fails any of them is not recommended live: it is recommended
    `hold` (the item's typing is sound) or `exclude` (the item is already excluded for a typing problem, so its typed
    shape may be unusable), with the reason, and listed in the report.
  * a recommendation never overwrites a human verdict (auto_pass_gates.g2_merge keeps those); an exclude may carry the
    agent's own derivation of the right answer (`if_corrected`) for Samuel; it is never applied.
  * every fix that changes a stem carries `stem_fix_by` ("… not Samuel"), so the console and apply_review_verdicts.py say so;
    a stem repair, a teaching-only retype and anything the agent was unsure of is `confidence: low` ("your call").
"""

from __future__ import annotations

import difflib
import hashlib
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

from pydantic import ValidationError

import book_config
import review_policy
from assemble_lesson_bundle import (AssemblyError, RunItem, choice_option_problems, marker_check, marker_spec_problems,
                                    unwrap_math_delimiters)

HERE = Path(__file__).resolve().parent
PROMPTS_VERSION = "g2rec-v1"
WORKFLOW = HERE / "runbook" / "g2-recommend.workflow.js"
SIGNER = review_policy.auto_pass_by("G2")
STEM_FIX_BY = "auto-pass G2 recommendation (g2rec-v1) — not Samuel"
LETTERS = "ABCDE"
MARKER_KINDS = ("expression", "equation", "values", "interval", "coordinates", "surd", "recurring")
APP_FORMS = ("factorised", "expanded", "simplest", "decimal")
# the classes an agent may name (the workflow's CLASSES: tests/test_g2_recommend.py compares the two), and the ones this module adds
CLASSES = ("book answer confirmed", "printed text damaged", "check too strict", "typing error", "compound answer",
           "selected from a list", "no working", "several parts", "printed answer misaligned", "item wording", "book error",
           "stem damaged", "partial answer", "several accepted answers", "marker cannot check", "needs the page image",
           "unverified")
UNCONFIRMED = "unconfirmed"            # the independent verifier did not confirm a verdict that would put a question live
NOT_GROUNDED = "not grounded"          # the book quote is not in the item's book text
REFUSED = "refused"                    # the fix or the item's typed shape fails the pipeline's own checks
# what a prompt needs of an item, and nothing else
PROMPT_FIELDS = ("ref", "kind", "stem", "answer_type", "answer", "choices", "marker", "solution", "solution_provenance",
                 "printed_answer", "epub_final_answer", "blind_answer", "verification", "typing_problems", "figures",
                 "asked_form", "printed_form_defect", "raised_dot", "options_source", "not_markable_reason",
                 "printed_page", "less_specific")
# the cost model (API-equivalent USD; MODELLED until the first run is metered): a recommending agent reads a batch of ~8 items and
# derives each answer at effort high; a verifying agent does the same for the verdicts that would go live (about 60%)
UNIT_COST = {"recommend_item": (0.10, 0.20), "verify_item": (0.05, 0.10), "verify_share": 0.6}


class RecommendError(Exception):
    pass


# ============================================================================ which items, and the packet
def _lesson_key(slug: str) -> list[int]:
    return [int(x) for x in re.findall(r"\d+", slug)]


def load_run(path: Path | str) -> dict:
    d = json.loads(Path(path).read_text())
    return d.get("result", d)


def recommendable(runs: list[dict], chapter: int | None, prefix: str, g2: dict | None) -> list[dict]:
    """The items that owe a recommendation, in book order: [{key, lesson, ref, state, item}].

    `state` is `held` (the three-way check disagreed and the checks' rule has no verdict) or `excluded` (the typing check flagged
    it and the rule excludes it). Never: an item the rule accepts (no printed answer, the re-solve agreed with the book), a teaching
    item (typed not markable, nothing marked, no verdict owed), or one a PERSON decided in G2's file (an auto verdict does not count:
    it is recomputed). It is the same set g2_merge decides, taken from the runs and not from G2's file, so building the packet
    again after a recommendation was applied gives the same items."""
    import auto_pass_gates as A
    owed: dict[str, dict] = {}
    full: dict[str, tuple[str, dict, int]] = {}
    n = 0
    for run in runs:
        run = run.get("result", run)
        owed.update(A.g2_items(run, chapter, prefix))
        for l in run.get("lessons") or []:
            if not l or (chapter is not None and not str(l.get("lesson", "")).startswith(f"{prefix}{chapter}s")):
                continue
            for it in l.get("items") or []:
                full[f"{l['lesson']}:{it['ref']}"] = (l["lesson"], it, n)
                n += 1
    human = {k for k, v in ((g2 or {}).get("items") or {}).items()
             if not (v.get("auto") or review_policy.is_auto(v.get("by")))}
    out = []
    for key in sorted(owed, key=lambda k: (_lesson_key(full[k][0]), full[k][2])):
        o = owed[key]
        if key in human:
            continue
        if o.get("answer_type") == "not_markable" and not o.get("typing_problems"):
            continue
        rule = A.g2_rule(o)
        if rule and rule[0] == "accept":
            continue
        lesson, it, _ = full[key]
        out.append({"key": key, "lesson": lesson, "ref": it["ref"], "state": "excluded" if rule else "held", "item": it})
    return out


def prompt_item(it: dict) -> dict:
    d = {k: it.get(k) for k in PROMPT_FIELDS}
    d["pairs"] = [{"p": str(p.get("pair_id", "")).split("|")[-1], "v": p.get("verdict"),
                   **({"r": p["reason"]} if p.get("reason") else {})} for p in (it.get("verify") or {}).get("pairs") or []]
    return d


def items_sha256(entries: list[dict]) -> str:
    blob = json.dumps([{"key": e["key"], "state": e["state"], "item": prompt_item(e["item"])} for e in entries],
                      ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()


def lesson_titles(book) -> dict[str, str]:
    try:
        manifest = json.loads(book.repo_path(book.manifest).read_text())
    except (OSError, ValueError, AttributeError, TypeError):
        return {}
    return {l["id"]: l.get("title", "") for m in manifest.get("modules") or [] for l in m.get("lessons") or []}


def build_args(book, chapter: int, entries: list[dict], *, part: int = 1, parts: int = 1, batch: int = 8, verify_batch: int = 8,
               model: str = "sonnet", effort: str = "high", titles: dict[str, str] | None = None) -> dict:
    """The packet a generated copy of g2-recommend.workflow.js carries (embed_workflow.py)."""
    if not entries:
        raise RecommendError("no item owes a recommendation")
    slugs = sorted({e["lesson"] for e in entries}, key=_lesson_key)
    rules = getattr(book, "answer_rules", None)
    return {"book": {"book": book.book, "multiplication_dot": bool(getattr(rules, "multiplication_dot", False))},
            "stage": "G2R", "prompts_version": PROMPTS_VERSION, "chapter": chapter, "part": part, "parts": parts,
            "batch": batch, "verify_batch": verify_batch, "model": model, "effort": effort,
            "items_sha256": items_sha256(entries),
            "lessons": {s: (titles or {}).get(s, "") for s in slugs},
            "items": [{"key": e["key"], "lesson": e["lesson"], "state": e["state"], "item": prompt_item(e["item"])}
                      for e in entries]}


def split_parts(entries: list[dict], batch: int, max_batches: int) -> list[list[dict]]:
    """Whole batches per run, in order (a run is at most `max_batches` recommending agents plus their verifiers)."""
    per = max(1, max_batches) * batch
    return [entries[i:i + per] for i in range(0, len(entries), per)] or [[]]


def estimate(n_items: int, batch: int = 8) -> dict:
    lo_r, hi_r = UNIT_COST["recommend_item"]
    lo_v, hi_v = UNIT_COST["verify_item"]
    share = UNIT_COST["verify_share"]
    rec_agents = -(-n_items // batch)
    ver_agents = -(-int(round(n_items * share)) // batch)
    return {"items": n_items, "recommend_agents": rec_agents, "verify_agents_max": ver_agents,
            "agents": rec_agents + ver_agents,
            "usd_low": round(n_items * lo_r + n_items * share * lo_v, 2), "usd_high": round(n_items * hi_r + n_items * share * hi_v, 2)}


# ============================================================================ checks on a recommended shape
def _norm(s) -> str:
    t = unicodedata.normalize("NFKC", str(s if s is not None else ""))
    t = t.replace("−", "-").replace("–", "-")
    t = re.sub(r"\\(?:left|right|displaystyle)(?![a-zA-Z])", "", t)
    t = re.sub(r"\\[,;:! ]|\\q?quad(?![a-zA-Z])|~", "", t)
    t = re.sub(r"\\[dt]frac(?![a-zA-Z])", r"\\frac", t)
    for _ in range(3):
        t = re.sub(r"\\(?:text|mathrm|textrm|mbox)\{([^{}]*)\}", r"\1", t)
    t = t.replace("$", "").replace("{", "").replace("}", "")
    return re.sub(r"\s+", "", t).lower()


def _sig(s) -> str:
    """Digits, letters and the few operators that survive a re-typing: what a key must keep of the quote it is copied from."""
    t = re.sub(r"\\[a-zA-Z]+", "", unicodedata.normalize("NFKC", str(s if s is not None else "")).replace("−", "-"))
    t = re.sub(r"(\d)\{,\}(\d)", r"\1.\2", t)
    t = re.sub(r"(\d),(\d)", r"\1.\2", t)
    return re.sub(r"[^0-9A-Za-z+\-=<>.]", "", t).lower()


def _subsequence(needle: str, hay: str) -> bool:
    it = iter(hay)
    return all(c in it for c in needle)


def book_sources(item: dict) -> list[str]:
    return [" ".join(item.get("solution") or []), item.get("epub_final_answer") or "", item.get("printed_answer") or ""]


def grounded(item: dict, quote: str | None) -> bool:
    nq = _norm(quote)
    return bool(nq) and any(nq in _norm(s) for s in book_sources(item))


def _clean_numeric(key: str) -> str:
    k = re.sub(r"\\(?:text|mathrm|textrm|mbox)\{([^{}]*)\}", r"\1", str(key or "")).replace("$", "")
    k = re.sub(r"\s*[A-Za-z%°][A-Za-z%°0-9\s]*$", "", k)
    return k.strip()


def _as_number(key: str) -> bool:
    k = _norm_number(key)
    return bool(re.fullmatch(r"-?\d+(?:\.\d+)?(?:/\d+)?", k))


def _norm_number(key: str) -> str:
    k = str(key or "").replace("−", "-").replace(" ", "")
    return re.sub(r"(\d),(\d)", r"\1.\2", re.sub(r"(\d)\{,\}(\d)", r"\1.\2", k))


def typed_fields(item: dict, fix: dict | None) -> tuple[dict, list[str]]:
    """The G2 `fields` a fix means, from the agent's typed answer: the item's complete new typing, as the pilot's fixes wrote it
    (answer_type, answer, marker, choices, …), only what differs from the item. Returns (fields, problems)."""
    fix = fix or {}
    problems: list[str] = []
    at = fix.get("answer_type")
    key = str(fix.get("key") or "").strip()
    f: dict = {}
    if not at:
        # no change of typing: a repair of the stem or the printed answer alone (the key stays the book's)
        if not (fix.get("stem") or fix.get("printed_answer") or fix.get("unit")):
            return {}, ["a fix names no answer type and nothing else to change"]
        if fix.get("less_specific") or fix.get("answer_only") or fix.get("options") or key:
            return {}, ["a fix that does not name an answer type may only repair the stem, the printed answer or the unit"]
    elif at == "numeric":
        k = _clean_numeric(key)
        if not _as_number(k):
            problems.append(f"a numeric key is ONE number; {key!r} is not (a fraction, a mixed number or an expression is typed expression)")
        f = {"answer_type": "numeric", "answer": k, "marker": None, "choices": None}
    elif at == "expression":
        kind = fix.get("marker_kind")
        if kind not in MARKER_KINDS:
            problems.append(f"marker kind {kind!r} is not one of {', '.join(MARKER_KINDS)}")
        if not key:
            problems.append("an expression fix has no key")
        form = fix.get("form") or None
        if form == "subject":
            form = {"subject": fix["subject"]} if fix.get("subject") else None
            if form is None:
                problems.append('form "subject" names no variable')
        elif form and form not in APP_FORMS:
            problems.append(f"form {form!r} is not one the app's marker knows")
            form = None
        af = item.get("asked_form")
        if isinstance(af, str) and af in APP_FORMS:
            form = af                                       # the book's rule wins (lesson.workflow.js checkTyping)
        elif isinstance(af, dict) and af.get("subject") and kind == "equation":
            form = {"subject": af["subject"]}
        elif af == "prime_factors":
            problems.append("the stem asks for a product of prime factors, which the app's marker cannot check: hold, never a fix")
        if item.get("raised_dot") and re.search(r"\d\.\d", key) and not re.search(r"\\cdot|\\times", key):
            problems.append("the book's raised dot is multiplication: a key writes \\cdot, not a decimal point")
        f = {"answer_type": "expression", "answer": key, "choices": None,
             "marker": {"kind": kind, "key": key, "form": form,
                        "variables": [v for v in fix.get("variables") or [] if isinstance(v, str) and v], "tolerance": None}}
    elif at == "choice":
        opts = [str(o).strip() for o in fix.get("options") or [] if str(o).strip()]
        if not 2 <= len(opts) <= 5:
            problems.append(f"a choice needs 2–5 options, not {len(opts)}")
        if len({_norm(o) for o in opts}) != len(opts):
            problems.append("a choice's options repeat")
        at_i = next((i for i, o in enumerate(opts) if _norm(o) == _norm(key)), -1)
        if at_i < 0:
            problems.append("the key is not the text of one of the options")
        less, bad = [], []
        for x in fix.get("less_specific") or []:
            j = next((i for i, o in enumerate(opts) if _norm(o) == _norm(x)), -1)
            (less if j >= 0 else bad).append(LETTERS[j] if j >= 0 else x)
        if bad:
            problems.append(f"less_specific names text that is not an option: {bad}")
        if at_i >= 0 and LETTERS[at_i] in less:
            problems.append("the key is the most specific answer, not a less specific one")
        src = fix.get("options_source") or None
        if src not in ("stem", "figure", "lesson"):
            problems.append("a choice fix names where its options come from: the stem, a figure or the lesson's closed set")
        elif src == "figure" and not item.get("figures"):
            problems.append("options said to be a figure's labels, but the item has no figure")
        f = {"answer_type": "choice", "answer": LETTERS[at_i] if at_i >= 0 else None, "marker": None,
             "choices": [{"key": LETTERS[i], "text": o} for i, o in enumerate(opts[:5])],
             "options_source": src}
        if less:
            f["less_specific"] = less
    elif at == "not_markable":
        why = str(fix.get("not_markable_reason") or "").strip()
        if not why:
            problems.append("a teaching-only retype names its reason")
        f = {"answer_type": "not_markable", "answer": None, "marker": None, "choices": None, "not_markable_reason": why}
    else:
        return {}, [f"a fix names no answer type ({at!r})"]
    if fix.get("answer_only"):
        f["answer_only"] = True
    if fix.get("unit"):
        f["unit"] = str(fix["unit"]).strip()
    if fix.get("printed_answer"):
        f["printed_answer"] = str(fix["printed_answer"])
    if fix.get("stem") and str(fix["stem"]).strip() != str(item.get("stem") or "").strip():
        f["stem"] = str(fix["stem"]).strip()
        problems += stem_repair_problems(item.get("stem") or "", f["stem"])
    # what the new type no longer carries is cleared, so no stale option set or flag rides along (only when the typing changes)
    for stale in ("less_specific", "options_source", "answer_only", "not_markable_reason") if at else ():
        if stale not in f and item.get(stale) not in (None, "", False):
            f[stale] = None
    return {k: v for k, v in f.items() if item.get(k) != v}, problems


def stem_repair_problems(old: str, new: str) -> list[str]:
    """A stem repair restores text the book's own working proves was lost; it is never a rewrite."""
    out = []
    ratio = difflib.SequenceMatcher(None, old, new).ratio()
    if ratio < 0.85 or abs(len(new) - len(old)) > 24:
        out.append(f"the stem was rewritten, not repaired (similarity {ratio:.2f}, {len(new) - len(old):+d} characters)")
    if "[figure]" in old and "[figure]" not in new:
        out.append("the repaired stem drops its [figure]")
    return out


def structural_problems(after: dict, verdict: str) -> list[str]:
    """What the pipeline's own models and rules say about the item as it WOULD be (typing_problems cleared, so every
    rule is recomputed): RunItem, the choice-option rules, the marker-spec rules, a numeric key that is a number, the
    options a 'stem' choice claims to take from the stem. Empty = the assembly will take it."""
    d = dict(after)
    d["typing_problems"] = []
    out = [*choice_option_problems(d), *marker_spec_problems(d)]
    try:
        RunItem.model_validate({**d, "g2": {"verdict": verdict, "by": SIGNER}})
    except ValidationError as e:
        x = e.errors()[0]
        out.append(str(x.get("msg", "invalid")).removeprefix("Value error, "))
    if d.get("answer_type") == "numeric" and d.get("answer") and not _as_number(d["answer"]):
        out.append(f"typed numeric but its key {d['answer']!r} is not a number (the assembly refuses it)")
    if d.get("answer_type") == "choice" and d.get("options_source") == "stem":
        st = _norm(d.get("stem"))
        gone = [c.get("text") for c in d.get("choices") or [] if _norm(c.get("text")) not in st]
        if gone:
            out.append("options said to be the stem's are not all in the stem: " + ", ".join(f'"{g}"' for g in gone[:3]))
    return out


def marker_rows(key_to_after: dict[str, dict]) -> list[dict]:
    rows = []
    for key, a in key_to_after.items():
        if a.get("answer_type") == "expression" and isinstance(a.get("marker"), dict):
            m = dict(a["marker"])
            m["key"] = unwrap_math_delimiters(m.get("key"))
            rows.append({"id": key, "choices": {"marker": m, **({"answer_only": True} if a.get("answer_only") else {})}})
    return rows


def run_marker_check(rows: list[dict]) -> dict[str, str]:
    """{key: why} for the specs the app's marker rejects and the keys it cannot read (the assembly's own check)."""
    if not rows:
        return {}
    try:
        res = marker_check(rows)
    except AssemblyError as e:
        raise RecommendError(str(e)) from e
    out = {x["id"]: f"the app's marker rejects the spec: {x['why']}" for x in res.get("specs_rejected") or []}
    out.update({x["id"]: f"the app's marker cannot read the key {x['key']!r}: {x['why']}" for x in res.get("keys_unreadable") or []})
    return out


IDENTITY = HERE / "g2rec_identity.mjs"
_IDENT_VERB = re.compile(r"^\s*(?:answer the following:\s*)?(?:simplify|expand|factori[sz]e)\b", re.I)


def identity_expr(stem: str | None) -> str | None:
    """The expression a "Simplify / Expand / Factorise" stem asks to be transformed (its one `$…$` segment), or None: the book's
    key must equal it in value. Anything else (a calculation, a word problem, two segments) has no identity to check."""
    s = str(stem or "")
    if not _IDENT_VERB.match(s):
        return None
    segs = re.findall(r"\$([^$]+)\$", s)
    return segs[0].strip() if len(segs) == 1 and segs[0].strip() else None


def _letters(expr: str) -> list[str]:
    t = re.sub(r"\\(?:text|mathrm|mbox|textrm)\{[^{}]*\}", "", expr)
    t = re.sub(r"\\[a-zA-Z]+", "", t)
    return sorted(set(re.findall(r"[A-Za-z]", t)))


def identity_rows(key_to_after: dict[str, dict]) -> list[dict]:
    rows = []
    for key, a in key_to_after.items():
        e = identity_expr(a.get("stem"))
        if e and a.get("answer_type") == "expression" and isinstance(a.get("marker"), dict) and a["marker"].get("kind") == "expression":
            m = {"kind": "expression", "key": unwrap_math_delimiters(a["marker"].get("key")), "form": None,
                 "variables": _letters(e), "tolerance": None}
            rows.append({"id": key, "expr": e, "marker": m})
    return rows


def run_identity_check(rows: list[dict]) -> dict[str, str]:
    """{key: 'equal' | 'different' | 'unreadable'} from the app's own marker (g2rec_identity.mjs)."""
    if not rows:
        return {}
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        raise RecommendError("the identity check needs node (it runs the app's own answer-marker.ts)")
    r = subprocess.run([node, "--no-warnings", str(IDENTITY), "-"], input="".join(json.dumps(x, ensure_ascii=False) + "\n" for x in rows),
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise RecommendError(f"the identity check could not run: {r.stderr.strip()[-300:]}")
    return json.loads(r.stdout)["results"]


def identity_preview(entries: list[dict], check=run_identity_check) -> dict:
    """What the app's marker says about the BOOK'S OWN key of every item whose stem is an identity ("Simplify: …"): the key as typed
    for a held item (its typed shape is sound); for an excluded item whose key is typed expression likewise. Informational: it is
    shown when the packet is built and again by the collector, and it never decides a verdict by itself."""
    afters = {e["key"]: e["item"] for e in entries}
    res = check(identity_rows(afters))
    out = {"equal": sorted(k for k, v in res.items() if v == "equal"), "different": sorted(k for k, v in res.items() if v == "different"),
           "unreadable": sorted(k for k, v in res.items() if v == "unreadable")}
    out["not_an_identity"] = len(entries) - len(res)
    return out


# ============================================================================ the policy
def _clip(s, n) -> str:
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"


def _entry(verdict: str, klass: str, conf: str, note: str, *, why_low: str | None = None, fields: dict | None = None,
           verified: dict | None = None, if_corrected: dict | None = None) -> dict:
    e = {"verdict": verdict, "class": klass, "confidence": conf, "note": note}
    if conf == "low":
        e["why_low"] = why_low or "a content decision a person should make"
    if fields:
        e["fields"] = fields
        if "stem" in fields:
            e["stem_fix_by"] = STEM_FIX_BY
    if verified:
        e["verified"] = verified
    if if_corrected:
        e["if_corrected"] = if_corrected
    return e


def decide(entry: dict, rec: dict | None, ver: dict | None, marker_why: str | None = None) -> tuple[dict | None, dict]:
    """One item's recommended entry (or None: no recommendation) and a log line {outcome, why}. The policy of the module docstring."""
    item, state = entry["item"], entry["state"]
    if not rec:
        return None, {"outcome": "unanswered", "why": "the recommending agent gave no verdict"}
    verdict = rec.get("verdict")
    klass = rec.get("class") if rec.get("class") in CLASSES else "unverified"
    conf = rec.get("confidence") if rec.get("confidence") in ("high", "low") else "low"
    note = _clip(rec.get("note"), 420)
    why_low = _clip(rec.get("why_low"), 260) or None
    fallback = "exclude" if state == "excluded" else "hold"

    def down(why: str, k: str) -> tuple[dict, dict]:
        return (_entry(fallback, k, "low", f"NOT RECOMMENDED LIVE ({why}). The agent's reading: {note}",
                       why_low=f"the recommendation to put it live did not survive the checks: {why}"),
                {"outcome": "not live", "why": why, "kind": k, "agent_verdict": verdict})

    corrected = None
    if verdict == "exclude" and (rec.get("correct_answer") or rec.get("defect")):
        corrected = {"answer": _clip(rec.get("correct_answer"), 200), "defect": _clip(rec.get("defect"), 300),
                     "status": "NOT APPLIED: correcting the book's own answer or working is Samuel's to approve (decisions 43–45)"}
        note = _clip(note + (f" Right answer by the agent's own derivation: {corrected['answer']}." if corrected["answer"] else ""), 560)
    if verdict == "exclude":
        return _entry("exclude", klass, conf, note, why_low=why_low, if_corrected=corrected), {"outcome": "exclude"}
    if verdict == "hold":
        probs = structural_problems(item, "hold") if state == "excluded" else []
        if probs:
            return (_entry("exclude", klass, "low", f"{note} (kept out as exclude, not hold: its typed shape cannot be emitted — {probs[0]})",
                           why_low="a hold needs a well-formed item; this one's typing is unusable"),
                    {"outcome": "exclude", "why": "hold impossible: " + probs[0]})
        return _entry("hold", klass, conf, note, why_low=why_low), {"outcome": "hold"}
    if verdict not in ("accept", "fix"):
        return None, {"outcome": "unanswered", "why": f"unknown verdict {verdict!r}"}

    # --- a verdict that would put a question live
    fields: dict = {}
    if verdict == "fix":
        fields, probs = typed_fields(item, rec.get("fix"))
        if probs:
            return down("the fix is refused: " + "; ".join(probs[:3]), REFUSED)
        if not fields:
            verdict = "accept"                              # a fix that changes nothing is an accept
    after = {**item, **fields}
    teaching = after.get("answer_type") == "not_markable"
    probs = structural_problems(after, verdict)
    if probs:
        return down("the item would not pass the pipeline's own checks: " + "; ".join(probs[:3]), REFUSED)
    if not _clip(rec.get("book_quote"), 400) and not teaching:
        return down("no book quote: a verdict that puts a question live names the book span it rests on", NOT_GROUNDED)
    if not teaching and not grounded(item, rec.get("book_quote")):
        return down("the quoted span is not in the item's worked solution, EPUB answer or printed answer", NOT_GROUNDED)
    if verdict == "fix" and not teaching and ("answer" in fields or "marker" in fields):
        k = (after.get("marker") or {}).get("key") if after.get("answer_type") == "expression" else \
            next((c["text"] for c in after.get("choices") or [] if c["key"] == after.get("answer")), after.get("answer"))
        if _sig(k) and not _subsequence(_sig(k), _sig(rec.get("book_quote"))) and not _subsequence(_sig(rec.get("book_quote")), _sig(k)):
            return down(f"the re-typed key {_clip(k, 80)!r} is not the quoted book answer re-typed", NOT_GROUNDED)
    if marker_why:
        return down(marker_why, "marker cannot check")
    verified = None
    if not teaching:
        if not ver:
            return down("the independent verifier gave no answer for it", UNCONFIRMED)
        if ver.get("verdict") != "confirmed" or ver.get("other_correct_answers"):
            why = (f"the independent verifier said {ver.get('verdict')}"
                   + (", and another answer is also correct" if ver.get("other_correct_answers") else "")
                   + f" (its own answer: {_clip(ver.get('own_answer'), 120)}; {_clip(ver.get('note'), 200)})")
            return down(why, UNCONFIRMED)
        verified = {"by": "g2rec-v1 independent verifier", "own_answer": _clip(ver.get("own_answer"), 200), "verdict": "confirmed"}
    if "stem" in fields and conf != "low":
        conf, why_low = "low", "the stem was repaired from the book's own working: it changes the question's text"
    if teaching and conf != "low":
        conf, why_low = "low", "a teaching-only retype: the item will never be marked"
    note = _clip(note + (" Verified independently: the verifier's own answer matches the key." if verified else ""), 560)
    return _entry(verdict, klass, conf, note, why_low=why_low, fields=fields or None, verified=verified), {"outcome": verdict}


def collect(entries: list[dict], runs: list[dict], *, prior: dict | None = None, run_names: dict[str, str] | None = None,
            marker_fn=run_marker_check, chapter: int | None = None) -> dict:
    """The recommendation file from the saved run(s). `prior` is an earlier file for the same chapter: its items for keys these runs
    do not cover are kept (a re-run of the unanswered), these runs' answers win."""
    by_key = {e["key"]: e for e in entries}
    recs: dict[str, dict] = {}
    vers: dict[str, dict | None] = {}
    off_task: list[str] = []
    for run in runs:
        run = run.get("result", run)
        if run.get("prompts_version") not in (None, PROMPTS_VERSION):
            raise RecommendError(f"a run made with prompts {run.get('prompts_version')}, this collector is {PROMPTS_VERSION}")
        for r in run.get("results") or []:
            k = r.get("key")
            if k not in by_key:
                off_task.append(str(k))
                continue
            if r.get("rec"):
                recs[k] = r["rec"]
                vers[k] = r.get("ver")
    # pass 1: the item as it would be, for the app's marker (one node run for every candidate)
    afters: dict[str, dict] = {}
    for k, rec in recs.items():
        if rec.get("verdict") in ("accept", "fix"):
            fields = typed_fields(by_key[k]["item"], rec.get("fix"))[0] if rec["verdict"] == "fix" else {}
            afters[k] = {**by_key[k]["item"], **fields}
    markers = marker_fn(marker_rows(afters)) if afters else {}
    items: dict[str, dict] = {}
    log: dict[str, dict] = {}
    for e in entries:
        k = e["key"]
        out, why = decide(e, recs.get(k), vers.get(k), markers.get(k))
        log[k] = why
        if out:
            items[k] = out
    if prior:                                              # an earlier file's items for keys these runs did not answer
        for k, v in (prior.get("items") or {}).items():
            if k in by_key and k not in items:
                items[k] = v
    unanswered = [k for k in by_key if k not in items]
    c_verdict = Counter(v["verdict"] for v in items.values())
    report = {
        "items": len(entries), "recommended": len(items), "unanswered": unanswered,
        "by_verdict": dict(c_verdict), "by_class": dict(Counter(v["class"] for v in items.values())),
        "by_confidence": dict(Counter(v["confidence"] for v in items.values())),
        "live": sorted(k for k, v in items.items() if v["verdict"] in ("accept", "fix")),
        "not_live": {k: {"agent_verdict": w.get("agent_verdict"), "recommended": items[k]["verdict"], "kind": w.get("kind"), "why": w["why"]}
                     for k, w in log.items() if w["outcome"] == "not live" and k in items},
        "low_confidence": sorted(k for k, v in items.items() if v["confidence"] == "low"),
        "stem_repairs": sorted(k for k, v in items.items() if "stem" in (v.get("fields") or {})),
        "retyped": sorted(k for k, v in items.items() if v["verdict"] == "fix" and "answer_type" in (v.get("fields") or {})),
        "corrections_proposed": sorted(k for k, v in items.items() if v.get("if_corrected")),
        "off_task": off_task,
        "by_state": dict(Counter(e["state"] for e in entries)),
    }
    return {"status": "RECOMMENDATION ONLY — an AI line's, never a review. `auto_pass_gates.py g2 --recommend` reads `items` and signs "
                      f"each verdict `{SIGNER}`; a person's verdict in G2's file is never overwritten.",
            "prepared_by": f"g2_recommend.py {PROMPTS_VERSION}", "prompts_version": PROMPTS_VERSION, "chapter": chapter,
            "from_runs": run_names or {}, "by": None, "items": items, "unanswered": unanswered, "report": report}


# ============================================================================ preparing the copy
def part_path(base: Path, k: int) -> Path:
    """g2rec-ch01.workflow.js for the first part, g2rec-ch01.part2.workflow.js for the next (the working check's naming)."""
    base = Path(base)
    if k == 1:
        return base
    name = base.name
    stem = name[:-len(".workflow.js")] if name.endswith(".workflow.js") else base.stem
    return base.with_name(f"{stem}.part{k}.workflow.js")


def record_runs(book, chapter: int) -> list[Path]:
    """The lesson runs a chapter's G2 gate record names as evidence (`S2–S4 run …`), in its order."""
    rec = HERE / "runs" / book.book / "gates" / f"g2-ch{chapter:02d}.json"
    if not rec.exists():
        raise RecommendError(f"no G2 record {rec}: pass --lesson-run")
    out = [book_config.REPO_ROOT / e["path"] for e in json.loads(rec.read_text()).get("evidence") or []
           if str(e.get("label", "")).startswith("S2") and e.get("path")]
    if not out:
        raise RecommendError(f"{rec} names no S2–S4 run: pass --lesson-run")
    return out


def prepare(book, chapter: int, lesson_runs: list[Path], g2_path: Path | None, embed: Path | None = None, *, batch: int = 8,
            verify_batch: int = 8, model: str = "sonnet", effort: str = "high", max_batches: int = 24, args_out: Path | None = None,
            skip_keys: set[str] | None = None) -> dict:
    """The packet and its generated copies for one chapter (embed_workflow.py). Writes nothing without `embed` / `args_out`."""
    import embed_workflow
    runs = [load_run(p) for p in lesson_runs]
    g2 = json.loads(g2_path.read_text()) if g2_path and Path(g2_path).exists() else None
    entries = recommendable(runs, chapter, book.id_prefixes[0], g2)
    skipped = [e["key"] for e in entries if skip_keys and e["key"] in skip_keys]
    entries = [e for e in entries if not (skip_keys and e["key"] in skip_keys)]
    info: dict = {"chapter": chapter, "items": len(entries), "skipped_already_recommended": len(skipped),
                  "by_state": dict(Counter(e["state"] for e in entries)), "parts": 0, "copies": [], "args_files": [],
                  "estimate": estimate(len(entries), batch), "lesson_runs": [str(p) for p in lesson_runs]}
    if not entries:
        return info
    parts = split_parts(entries, batch, max_batches)
    info["parts"] = len(parts)
    titles = lesson_titles(book)
    for k, part in enumerate(parts, start=1):
        args = build_args(book, chapter, part, part=k, parts=len(parts), batch=batch, verify_batch=verify_batch, model=model,
                          effort=effort, titles=titles)
        info.setdefault("parts_detail", []).append({"part": k, "items": len(part), "batches": -(-len(part) // batch),
                                                    "items_sha256": args["items_sha256"]})
        if args_out:
            ao = part_path(Path(args_out), k)
            ao.parent.mkdir(parents=True, exist_ok=True)
            ao.write_text(json.dumps(args, ensure_ascii=False) + "\n")
            info["args_files"].append(str(ao))
        if embed:
            out = part_path(Path(embed), k)
            w = embed_workflow.write(WORKFLOW, args, out)
            bad = embed_workflow.verify(out)
            if bad:
                raise RecommendError(f"{out}: the copy does not verify: {bad[:2]}")
            info["copies"].append({"script": str(out), "bytes": w["bytes"], "generated_sha256": w["generated_sha256"]})
    return info


# ============================================================================ the commands (auto_pass_gates.py)
def follow_ups(book: str, chapter: int, lesson_runs: list[str], *, recommended: str, g2_file: str,
               db: str = "ainext_pilot_g10_ch08", run_label: str = "") -> list[str]:
    """The exact commands that apply a saved recommendation, in order (from services/extraction/). Lines starting with # are comments.

    The chapter's working check and S5 draft are built from the ASSEMBLED bundle, so apply the recommendation BEFORE they are
    launched: `fanout.py close-chapter N` then does steps 2-4 itself (it passes the recommendation file when it exists) and
    re-prepares those copies. After they were launched, run the explicit steps and a delta working check on the newly live items."""
    t = f"{chapter:02d}"
    lr = " ".join(f"--lesson-run {p}" for p in lesson_runs)
    gl = f'--run "{run_label}" ' if run_label else ""
    dsn = f"host=127.0.0.1 port=5432 dbname={db}"
    return [
        f"uv run auto_pass_gates.py g2-recommend-collect {book} --chapter {chapter} {lr} --run runs/{book}/g2rec/ch{t}-<runId>.json "
        f"--out {recommended}",
        f"uv run auto_pass_gates.py g2 {book} --chapter {chapter} {lr} --recommend {recommended} --into {g2_file} --split "
        f"--maths runs/{book}/maths/book/accepted.json {gl}".rstrip(),
        f"uv run assemble_lesson_bundle.py --book {book} --chapter {chapter} --report runs/{book}/fanout/assembly-ch{t}.json",
        f"uv run load_seed.py seed/{book}/g10m-course.json seed/{book}/g10m-c{t}.json --validate-only",
        f"# or, if chapter {chapter}'s working check and S5 draft are NOT launched yet, one command does the three steps above and re-prepares them:",
        f"#   uv run fanout.py close-chapter {chapter}",
        f"# only if chapter {chapter} is ALREADY loaded in {db} (it adds the newly live questions, releases the held ones, rejects the excluded):",
        f"pg_dump -h 127.0.0.1 -Fc {db} > work/{book}/backups/pilot-before-g2rec-ch{t}.dump",
        f'AINEXT_DB_DSN="{dsn}" AINEXT_ENVIRONMENT=mvp1 uv run load_seed.py seed/{book}/g10m-course.json seed/{book}/g10m-c{t}.json '
        f"--course course:us-g10-math-en --update --dry-run      # read the delta; then the same without --dry-run",
        f'AINEXT_DB_DSN="{dsn}" AINEXT_ENVIRONMENT=mvp1 uv run apply_review_verdicts.py --g2 {g2_file} --book {book} '
        f"--runs runs/{book}/lesson --dry-run      # then the same without --dry-run",
    ]
