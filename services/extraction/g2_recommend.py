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
    (marker_check.mjs: the same module the assembly runs) — and, where that marker can say (g2rec_identity.mjs, no model, deterministic),
    the key must be EQUAL TO THE EXPRESSION THE STEM ASKS TO TRANSFORM ("Simplify: …": a NOT-equal key is a book error or a damaged stem the
    agents did not catch) and EQUAL TO THE ANSWER THE BOOK STATES (its EPUB answer, the quoted span, the working's last line: a key the typing
    agent corrected is not the book's, and correcting a book's answer is Samuel's to approve); (5) keep a stem repair a repair (a few
    characters, never a rewrite, the [figure] marker kept); (6) be CONFIRMED by the independent verifier (it worked the stem alone and the
    key is right and no other answer is also right). Anything that fails any of them is not recommended live: it is recommended
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
# the cost model (API-equivalent USD; MODELLED until the first run is metered, stage G2R). The harness's fixed cost per agent is ~$0.094 (the
# working checker's measurement, README §10); an agent here adds a batch of 8 items to read (~10K tokens) and a derivation per item at effort
# high (~15-40K output tokens at $10/M), so a recommending agent is modelled at $0.30-0.75 and a verifying agent (the stem and the key only,
# fewer items worth deriving) at $0.20-0.50. At most one verifying agent per batch (every batch that has an accept or a fix).
UNIT_COST = {"recommend_agent": (0.30, 0.75), "verify_agent": (0.20, 0.50)}


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


# What the agents JUDGE on, as opposed to what the checks reported about it: the question, the book's working and answers, the blind answer,
# the figure, the typed KEY and the options a student would see. If one of these differs from what an agent was shown, its answer was about
# another item; a change of the typing's shape (a marker kind, a form), of the checks' pair verdicts or of the typing problems is not, because
# the collector re-validates every verdict on the item as it is NOW (RunItem, the app's marker, both oracles) and a fix is re-derived against it.
SUBSTANTIVE = ("ref", "kind", "stem", "solution", "solution_provenance", "printed_answer", "epub_final_answer", "blind_answer", "figures",
               "options_source", "less_specific", "asked_form", "printed_form_defect", "raised_dot")


def facts(item: dict) -> dict:
    d = {k: item.get(k) for k in SUBSTANTIVE}
    m = item.get("marker") if isinstance(item.get("marker"), dict) else {}
    ch = [c for c in item.get("choices") or [] if isinstance(c, dict)]
    d["typed_key"] = (m.get("key") if item.get("answer_type") == "expression" else
                      next((c.get("text") for c in ch if c.get("key") == item.get("answer")), None) if item.get("answer_type") == "choice"
                      else item.get("answer"))
    d["options"] = [c.get("text") for c in ch]
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
            "items": [{"key": e["key"], "lesson": e["lesson"], "state": e["state"], "item": prompt_item(e["item"]),
                       **({"identity": e["identity"]} if e.get("identity") else {})} for e in entries]}


def split_parts(entries: list[dict], batch: int, max_batches: int) -> list[list[dict]]:
    """Whole batches per run, in order (a run is at most `max_batches` recommending agents plus their verifiers)."""
    per = max(1, max_batches) * batch
    return [entries[i:i + per] for i in range(0, len(entries), per)] or [[]]


def estimate(n_items: int, batch: int = 8) -> dict:
    lo_r, hi_r = UNIT_COST["recommend_agent"]
    lo_v, hi_v = UNIT_COST["verify_agent"]
    rec_agents = -(-n_items // batch)
    return {"items": n_items, "recommend_agents": rec_agents, "verify_agents_max": rec_agents, "agents": 2 * rec_agents,
            "usd_low": round(rec_agents * lo_r + rec_agents * lo_v * 0.5, 2), "usd_high": round(rec_agents * (hi_r + hi_v), 2)}


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
        key = unwrap_math_delimiters(key) or ""
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


def identity_map(entries: list[dict], check=run_identity_check) -> dict[str, str]:
    """{key: equal | different | unreadable} for the items whose stem is an identity, as typed. {} where node is not available."""
    try:
        return check(identity_rows({e["key"]: e["item"] for e in entries}))
    except RecommendError:
        return {}


def identity_preview(entries: list[dict], check=run_identity_check) -> dict:
    """What the app's marker says about the BOOK'S OWN key of every item whose stem is an identity ("Simplify: …"): the key as typed
    for a held item (its typed shape is sound); for an excluded item whose key is typed expression likewise. Informational: it is
    shown when the packet is built and again by the collector, and it never decides a verdict by itself."""
    res = check(identity_rows({e["key"]: e["item"] for e in entries}))
    out = {"equal": sorted(k for k, v in res.items() if v == "equal"), "different": sorted(k for k, v in res.items() if v == "different"),
           "unreadable": sorted(k for k, v in res.items() if v == "unreadable")}
    out["not_an_identity"] = len(entries) - len(res)
    return out


def _final_piece(src) -> str | None:
    """The expression a piece of the book's own text ends on: the last row of an aligned working, the right-hand side of its last "="."""
    t = str(src or "")
    if not t.strip():
        return None
    t = re.sub(r"\\(?:begin|end)\{(?:align\*?|aligned|array\{[^}]*\})\}", "", t).replace("$", "")
    t = t.split("\\\\")[-1] if "\\\\" in t else t
    t = t.replace("&", "")
    t = re.sub(r"\\q?quad.*$", "", t)
    t = t.rsplit("=", 1)[-1] if "=" in t else t
    t = re.sub(r"[\s.]+$", "", t).strip()
    return t or None


_RAISED_DOT = re.compile(r"(?<=[0-9}\])A-Za-z])\s*\.\s*(?=[0-9{(\\A-Za-z])")


def _is_prose(c: str) -> bool:
    """A sentence ("25×10^{2013} has 2015 digits"), not an expression: the marker would read its words as letters and say 'different'."""
    t = re.sub(r"\\text\{[^{}]*\}", " ", c)
    t = re.sub(r"\\[a-zA-Z]+", " ", t)
    return bool(re.search(r"[A-Za-z]{2,}\s+[A-Za-z]{2,}", t)) or any(re.fullmatch(r"[A-Za-z]{3,}[.,;:]?", w) for w in t.split())


def book_candidates(item: dict, quote: str | None, multiplication_dot: bool = False) -> list[str]:
    """Where the book states its answer, as expressions the app's marker may read: the EPUB's final answer, the quote the agent grounded
    the key in, and the last line of the book's working. A sentence is left out (the marker cannot read prose). A book that prints
    multiplication as a raised dot (this one: decimals take a comma) has it flattened to "." even in the EPUB: it is read as a product."""
    out: list[str] = []
    # where the working states its answer: its last line, a "Note restrictions: …" line not counting; a last line that is a sentence is
    # the book's prose answer, and the line above it is only a step: no candidate then
    body = [x for x in item.get("solution") or [] if not re.match(r"\s*note\b", str(x), re.I)]
    last = _final_piece(body[-1]) if body else None
    last = None if last and _is_prose(last) else last
    for p in (_final_piece(item.get("epub_final_answer")), _final_piece(quote), last):
        if p and multiplication_dot:
            p = _RAISED_DOT.sub(r"\\cdot ", p)
        if p and not _is_prose(p) and p not in out:
            out.append(p)
    return out


def agreement_rows(key_to_after: dict[str, dict], quotes: dict[str, str | None], multiplication_dot: bool = False) -> list[dict]:
    rows = []
    for key, a in key_to_after.items():
        spec = None
        if a.get("answer_type") == "expression" and isinstance(a.get("marker"), dict) and a["marker"].get("kind") == "expression":
            spec = {"kind": "expression", "key": unwrap_math_delimiters(a["marker"].get("key")), "form": None, "tolerance": None}
        elif a.get("answer_type") == "numeric" and a.get("answer") and _as_number(a["answer"]):
            spec = {"kind": "expression", "key": _norm_number(a["answer"]), "form": None, "tolerance": None}
        if not spec:
            continue
        for i, c in enumerate(book_candidates(a, quotes.get(key), multiplication_dot)):
            rows.append({"id": f"{key}#{i}", "expr": c, "marker": {**spec, "variables": sorted(set(_letters(c)) | set(_letters(spec["key"])))}})
    return rows


def agreement_of(results: dict[str, str], key: str) -> str | None:
    """'equal' when the marker finds the key equal to ANY place the book states its answer; 'different' when it read at least one and
    every one it read differs; None when it read none (prose, a sentence: no signal)."""
    mine = [v for k, v in results.items() if k.rsplit("#", 1)[0] == key and v in ("equal", "different")]
    if not mine:
        return None
    return "equal" if "equal" in mine else "different"


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


def decide(entry: dict, rec: dict | None, ver: dict | None, marker_why: str | None = None, identity: str | None = None,
           agreement: str | None = None) -> tuple[dict | None, dict]:
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
    if identity == "different":
        return down("the app's own marker finds the key NOT equal to the expression the stem asks to transform (a book error, or a stem "
                    "the extraction damaged) — the independent derivations did not catch it", UNCONFIRMED)
    if agreement == "different":
        return down("the app's own marker finds the typed key NOT equal to the answer the book states (its EPUB answer, the quoted span, "
                    "the last line of its working): a key the typing agent corrected is not the book's, and correcting a book's answer is "
                    "Samuel's to approve", NOT_GROUNDED)
    verified = None
    if not teaching:
        if not ver:
            return down("the independent verifier gave no answer for it", UNCONFIRMED)
        if ver.get("verdict") != "confirmed" or ver.get("other_correct_answers"):
            why = (f"the independent verifier said {ver.get('verdict')}"
                   + (", and another answer is also correct" if ver.get("other_correct_answers") else "")
                   + f" (its own answer: {_clip(ver.get('own_answer'), 120)}; {_clip(ver.get('note'), 200)})")
            return down(why, UNCONFIRMED)
        verified = {"by": "g2rec-v1 independent verifier", "own_answer": _clip(ver.get("own_answer"), 200), "verdict": "confirmed",
                    **({"app_marker_identity": identity} if identity == "equal" else {}),
                    **({"app_marker_book_answer": agreement} if agreement == "equal" else {})}
    if "stem" in fields and conf != "low":
        conf, why_low = "low", "the stem was repaired from the book's own working: it changes the question's text"
    if teaching and conf != "low":
        conf, why_low = "low", "a teaching-only retype: the item will never be marked"
    note = _clip(note + (" Verified independently: the verifier's own answer matches the key." if verified else ""), 560)
    return _entry(verdict, klass, conf, note, why_low=why_low, fields=fields or None, verified=verified), {"outcome": verdict}


def question_id(item: dict) -> str:
    """The id the assembly mints for a book item's question (schemas.exercise_question_id / worked_example_question_id)."""
    import schemas
    if item.get("kind") == "worked_example":
        return schemas.worked_example_question_id(item["lo"], int(str(item["ref"])[2:]))
    return schemas.exercise_question_id(item["lo"], item["ref"])


def collect(entries: list[dict], runs: list[dict], *, prior: dict | None = None, run_names: dict[str, str] | None = None,
            marker_fn=run_marker_check, identity_fn=run_identity_check, chapter: int | None = None,
            multiplication_dot: bool = False, packets: list[dict | None] | None = None) -> dict:
    """The recommendation file from the saved run(s). `prior` is an earlier file for the same chapter: its items for keys these runs
    do not cover are kept (a re-run of the unanswered), these runs' answers win.

    `entries` are the items that owe a recommendation NOW (recommendable()); the run answered the items its packet held THEN, and a
    later collection (lesson-v8 → COLLECT-6 widened, 2026-10-01) can change what is owed. So, per item and never twice-decided:
      * a key the run answered that is no longer owed (the checks' own rule decides it now, or a person did) is SKIPPED with a note
        (`no_longer_owed`): its recommendation is not written, so g2 never overrides the rule's decision with an older reading;
      * a key still owed whose item is NOT what the agents were shown (`packets`: each run's args, as embedded in its copy; a fact
        they judged on differs: facts()) is REFUSED for that item (`stale_items`): nothing is recommended, it stays as the checks
        leave it, and `g2-recommend-args --only-missing` asks about it again;
      * the others are collected as before, so the agents' paid answers for the items still owed stay valid."""
    by_key = {e["key"]: e for e in entries}
    recs: dict[str, dict] = {}
    vers: dict[str, dict | None] = {}
    off_task: list[str] = []
    no_longer_owed: set[str] = set()
    stale: set[str] = set()
    same = lambda a, b: json.dumps(a, sort_keys=True, ensure_ascii=False) == json.dumps(b, sort_keys=True, ensure_ascii=False)  # noqa: E731
    for ri, run in enumerate(runs):
        run = run.get("result", run)
        if run.get("prompts_version") not in (None, PROMPTS_VERSION):
            raise RecommendError(f"a run made with prompts {run.get('prompts_version')}, this collector is {PROMPTS_VERSION}")
        packet = (packets[ri] if packets and ri < len(packets) else None) or {}
        pk = {x["key"]: x for x in packet.get("items") or []}
        run_keys = set(run.get("keys") or []) | set(pk)
        for r in run.get("results") or []:
            k = r.get("key")
            if k not in by_key:
                if k in run_keys:
                    no_longer_owed.add(str(k))
                else:
                    off_task.append(str(k))
                continue
            if k in pk and not same(facts(pk[k].get("item") or {}), facts(prompt_item(by_key[k]["item"]))):
                stale.add(k)
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
    # the app's own marker as a deterministic oracle, twice: is the key equal to the expression the stem asks to transform
    # ("Simplify: …"), and is it equal to the answer the book states? (no model; g2rec_identity.mjs)
    ident = identity_fn(identity_rows(afters)) if afters else {}
    agree = identity_fn(agreement_rows(afters, {k: recs[k].get("book_quote") for k in afters}, multiplication_dot)) if afters else {}
    ident_typed = identity_fn(identity_rows({k: e["item"] for k, e in by_key.items()}))
    items: dict[str, dict] = {}
    log: dict[str, dict] = {}
    for e in entries:
        k = e["key"]
        out, why = decide(e, recs.get(k), vers.get(k), markers.get(k), ident.get(k), agreement_of(agree, k))
        log[k] = why
        if out:
            items[k] = out
    if prior:                                              # an earlier file's items for keys these runs did not answer
        for k, v in (prior.get("items") or {}).items():
            if k in by_key and k not in items and k not in stale:
                items[k] = v
    unanswered = [k for k in by_key if k not in items]
    c_verdict = Counter(v["verdict"] for v in items.values())
    report = {
        "items": len(entries), "recommended": len(items), "unanswered": unanswered,
        "by_verdict": dict(c_verdict), "by_class": dict(Counter(v["class"] for v in items.values())),
        "by_confidence": dict(Counter(v["confidence"] for v in items.values())),
        "live": sorted(k for k, v in items.items() if v["verdict"] in ("accept", "fix")),
        # the question ids those become (a teaching-only retype is no question): what a delta working check is limited to
        "live_question_ids": sorted(question_id(by_key[k]["item"]) for k, v in items.items()
                                    if v["verdict"] in ("accept", "fix") and (v.get("fields") or {}).get("answer_type") != "not_markable"
                                    and by_key[k]["item"].get("answer_type") != "not_markable"),
        "not_live": {k: {"agent_verdict": w.get("agent_verdict"), "recommended": items[k]["verdict"], "kind": w.get("kind"), "why": w["why"]}
                     for k, w in log.items() if w["outcome"] == "not live" and k in items},
        "low_confidence": sorted(k for k, v in items.items() if v["confidence"] == "low"),
        "stem_repairs": sorted(k for k, v in items.items() if "stem" in (v.get("fields") or {})),
        "retyped": sorted(k for k, v in items.items() if v["verdict"] == "fix" and "answer_type" in (v.get("fields") or {})),
        "corrections_proposed": sorted(k for k, v in items.items() if v.get("if_corrected")),
        "off_task": off_task,
        "no_longer_owed": sorted(no_longer_owed), "stale_items": sorted(stale),
        "by_state": dict(Counter(e["state"] for e in entries)),
        # the app's own marker on the TYPED key of every item whose stem is "Simplify / Expand / Factorise: …" (informational): for a person
        # to set beside an agent's "book error" (a typed key can itself be a typing agent's correction of the book's)
        "app_marker_identity_of_the_typed_key": {w: sorted(k for k, v in ident_typed.items() if v == w) for w in ("equal", "different", "unreadable")},
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
            skip_keys: set[str] | None = None, preview_identity: bool = False) -> dict:
    """The packet and its generated copies for one chapter (embed_workflow.py). Writes nothing without `embed` / `args_out`.
    `preview_identity`: also run the app's marker over the typed keys of the items whose stem is an identity (informational)."""
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
    ident = identity_map(entries) if (preview_identity or embed or args_out) else {}
    for e in entries:                              # the app's marker's fact about the typed key, shown to the recommender (not the verifier)
        if ident.get(e["key"]) in ("equal", "different"):
            e["identity"] = ident[e["key"]]
    if preview_identity:
        info["identity_preview"] = ({"equal": sorted(k for k, v in ident.items() if v == "equal"),
                                     "different": sorted(k for k, v in ident.items() if v == "different"),
                                     "unreadable": sorted(k for k, v in ident.items() if v == "unreadable"),
                                     "not_an_identity": len(entries) - len(ident)} if ident else {"unavailable": "no node, or no identity stem"})
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
            archive_packet(out, w["generated_sha256"], args)
            info["copies"].append({"script": str(out), "bytes": w["bytes"], "generated_sha256": w["generated_sha256"]})
    return info


ARCHIVE = "g2rec-archive"


def archive_packet(copy: Path, generated_sha256: str, args: dict) -> Path:
    """Keep a copy's packet by its generated sha256, beside the copies: a saved run names its copy by that sha (`embedded.generated_sha256`),
    and the collector compares what the agents were shown with what is owed NOW, even after the copy file has been regenerated."""
    d = Path(copy).parent / ARCHIVE
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{generated_sha256}.args.json"
    if not p.exists():
        p.write_text(json.dumps(args, ensure_ascii=False) + "\n")
    return p


def find_packet(book, generated_sha256: str | None) -> dict | None:
    """The args a run's copy carried (its `embedded.generated_sha256`): from the archive, else from a copy still on disk. None: not found."""
    if not generated_sha256:
        return None
    import embed_workflow
    base = HERE / "work" / book.book / "packets" / "embedded" / "fanout"
    a = base / ARCHIVE / f"{generated_sha256}.args.json"
    if a.exists():
        return json.loads(a.read_text())
    for side in sorted(base.glob("g2rec-*.workflow.json")):
        try:
            if json.loads(side.read_text()).get("generated_sha256") == generated_sha256 and side.with_suffix(".js").exists():
                return embed_workflow.read_args(side.with_suffix(".js"))
        except (ValueError, OSError):
            continue
    return None


def delta_ids(bundle: dict, flags: dict) -> list[str]:
    """The solutions of an assembled chapter bundle (with working to check) that the chapter's working check never covered
    (`checked_ids` of runs/<book>/working-check/chNN.flags.json): the questions a recommendation, or a newer collection, made part of
    the bundle after the check ran. A delta working check (`working_check.py args --only`) is limited to them."""
    import working_check as W
    checked = set(flags.get("checked_ids") or [])
    return sorted(s["id"] for s in W.solutions_from_bundle(bundle) if W.has_working(s) and s["id"] not in checked)


# ============================================================================ the commands (auto_pass_gates.py)
def follow_ups(book: str, chapter: int, lesson_runs: list[str], *, recommended: str, g2_file: str,
               db: str = "ainext_pilot_g10_ch08", run_label: str = "") -> list[str]:
    """The exact commands that apply a saved recommendation, in order (from services/extraction/). Lines starting with # are comments.

    The chapter's working check and S5 draft are built from the ASSEMBLED bundle, which the recommendation changes: ideally it is applied
    BEFORE they are launched (`fanout.py close-chapter N` then does steps 2-4 itself, passing the recommendation file once it exists, and
    re-prepares them). If they ran already (Chapters 1 and 2), check what the bundle gained since: `g2-recommend-delta` lists the bundle's
    solutions the working check never covered, and `working_check.py args --only` limits a second check to them.

    If the lesson runs were RE-COLLECTED after the recommendation run was made (lesson.workflow.js COLLECT-6 widened, 2026-10-01), do that first and
    re-run G2 on them before collecting: the collector then skips what the checks now decide and refuses what changed (README §7c)."""
    t = f"{chapter:02d}"
    lr = " ".join(f"--lesson-run {p}" for p in lesson_runs)
    gl = f'--run "{run_label}" ' if run_label else ""
    dsn = f"host=127.0.0.1 port=5432 dbname={db}"
    delta = f"runs/{book}/g2rec/ch{t}.delta-ids.json"
    return [
        f"uv run auto_pass_gates.py g2-recommend-collect {book} --chapter {chapter} {lr} --run runs/{book}/g2rec/ch{t}-<runId>.json "
        f"--out {recommended}",
        f"uv run auto_pass_gates.py g2 {book} --chapter {chapter} {lr} --recommend {recommended} --into {g2_file} --split "
        f"--maths runs/{book}/maths/book/accepted.json {gl}".rstrip(),
        f"uv run assemble_lesson_bundle.py --book {book} --chapter {chapter} --report runs/{book}/fanout/assembly-ch{t}.json",
        f"uv run load_seed.py seed/{book}/g10m-course.json seed/{book}/g10m-c{t}.json --validate-only",
        f"# or, if chapter {chapter}'s working check and S5 draft are NOT launched yet, one command does the three steps above and re-prepares them:",
        f"#   uv run fanout.py close-chapter {chapter}",
        f"# if its working check ALREADY ran, check only what the assembled bundle gained since (two independent passes, A then B reshuffled):",
        f"#   uv run auto_pass_gates.py g2-recommend-delta {book} --chapter {chapter} --out {delta}",
        f"#   uv run working_check.py args --book {book} --seed seed/{book}/g10m-c{t}.json --chapter {chapter} --pass-id A --only {delta} "
        f"--by-ref work/{book}/packets/fanout/wcheck-ch{t}-g2rec-A --out work/{book}/packets/fanout/wcheck-ch{t}-g2rec-A.args.json "
        f"--embed work/{book}/packets/embedded/fanout/wcheck-ch{t}-g2rec-A.workflow.js",
        f"#   uv run working_check.py args --book {book} --seed seed/{book}/g10m-c{t}.json --chapter {chapter} --pass-id B --order shuffled --order-seed 11 "
        f"--only {delta} --by-ref work/{book}/packets/fanout/wcheck-ch{t}-g2rec-B "
        f"--out work/{book}/packets/fanout/wcheck-ch{t}-g2rec-B.args.json --embed work/{book}/packets/embedded/fanout/wcheck-ch{t}-g2rec-B.workflow.js",
        f"#   (run both copies; then working_check.py collect --args A.json --args B.json --runs <A run> <B run> --out runs/{book}/working-check/ch{t}.g2rec.flags.json)",
        f"# only if chapter {chapter} is ALREADY loaded in {db} (it adds the newly live questions, releases the held ones, rejects the excluded):",
        f"pg_dump -h 127.0.0.1 -Fc {db} > work/{book}/backups/pilot-before-g2rec-ch{t}.dump",
        f'AINEXT_DB_DSN="{dsn}" AINEXT_ENVIRONMENT=mvp1 uv run load_seed.py seed/{book}/g10m-course.json seed/{book}/g10m-c{t}.json '
        f"--course course:us-g10-math-en --update --dry-run      # read the delta; then the same without --dry-run",
        f'AINEXT_DB_DSN="{dsn}" AINEXT_ENVIRONMENT=mvp1 uv run apply_review_verdicts.py --g2 {g2_file} --book {book} '
        f"--runs runs/{book}/lesson --dry-run      # then the same without --dry-run",
    ]
