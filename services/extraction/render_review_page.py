"""Render review pages for the human gates: the legacy G3 page, and the G1–G4 dossiers.

    uv run render_review_page.py <bundle.json> --queue <q.json> --out page.html   # legacy G3
    uv run render_review_page.py --gate g1 --book g10-math --chapter 8 --out g1.html
    uv run render_review_page.py --gate g2 --book g10-math --chapter 8 --out g2.html
    uv run render_review_page.py --gate g3 --bundles seed/generated/g10-math/generated-questions.json \
        --bundles seed/generated/g10-math/widget-questions.json \
        --catalogue seed/generated/g10-math/misconceptions.json --out g3.html
    uv run render_review_page.py --gate g4 --catalogue seed/generated/g10-math/misconceptions.json \
        --s5 runs/g10-math/misconceptions/<run>.json --out g4.html

The dossiers are described at the head of their section below (B17).

The legacy page renders a generated question bundle as a human review page.

The reviewer's job is to find mathematics that is plausible and wrong, so the
page has to show everything that could be wrong: the stem, every choice, which
one is keyed correct, the worked solution the tutor will teach from when a
student misses it, and the misconception each distractor claims to encode. A
review surface that hides the answer key or the solution cannot catch an answer
key that disagrees with its own solution, which is the single most likely defect
in machine-authored items.

LaTeX is converted to Unicode rather than typeset. KaTeX's stylesheet cannot be
loaded from the artifact CSP's allowed hosts, and inlining it to typeset nine
distinct commands would be a worse trade than a transform whose entire
vocabulary fits on one screen. The transform is deliberately CLOSED: an unknown
command raises rather than passing a stray backslash through to a reviewer, who
would then be reading different notation from the student.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

# Structural commands handled by rewriting rather than substitution, because a
# fraction is a shape and not a character. \frac{a}{b} becomes a/b with the
# parts bracketed when they are compound, which is how a person reads one aloud
# and is unambiguous in a review context. Typesetting it properly would mean
# KaTeX, whose stylesheet no CSP-allowed host serves.
SYMBOLS = {
    r"\times": "\u00d7",
    r"\div": "\u00f7",
    r"\le": "\u2264",
    r"\ge": "\u2265",
    r"\neq": "\u2260",
    r"\in": "\u2208",
    r"\subseteq": "\u2286",
    r"\subset": "\u2282",
    r"\cup": "\u222a",
    r"\cap": "\u2229",
    r"\to": "\u2192",
    r"\varnothing": "\u2205",
    r"\emptyset": "\u2205",
    r"\cdot": "\u00b7",
    r"\pm": "\u00b1",
    r"\circ": "\u00b0",
    r"\angle": "\u2220",
    r"\approx": "\u2248",
    r"\pi": "\u03c0",
    r"\sin": "sin\u2009",
    r"\cos": "cos\u2009",
    r"\tan": "tan\u2009",
    r"\left": "",
    r"\right": "",
}
BLACKBOARD = {"Z": "\u2124", "R": "\u211d", "N": "\u2115", "Q": "\u211a"}
SUPERSCRIPT = {"0": "\u2070", "1": "\u00b9", "2": "\u00b2", "3": "\u00b3",
               "4": "\u2074", "5": "\u2075", "6": "\u2076", "7": "\u2077",
               "8": "\u2078", "9": "\u2079", "n": "\u207f"}


def _brace(src: str, start: int) -> tuple[str, int]:
    """Read a balanced {...} group beginning at `start`; return its body and end."""
    assert src[start] == "{"
    depth, i = 0, start
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start + 1:i], i + 1
        i += 1
    raise ValueError(f"unbalanced braces in {src!r}")


def _wrap(part: str) -> str:
    """Bracket a fraction part unless it is already a single atom."""
    part = part.strip()
    simple = re.fullmatch(r"-?[0-9A-Za-z\u00b0\u221a().]+", part)
    return part if simple else f"({part})"


def _expand_structural(tex: str) -> str:
    r"""Rewrite \frac and \sqrt, innermost first, until none remain."""
    for _ in range(12):
        m = re.search(r"\\(frac|sqrt)\{", tex)
        if not m:
            return tex
        cmd = m.group(1)
        first, after = _brace(tex, m.end() - 1)
        first = _expand_structural(first)
        if cmd == "sqrt":
            replacement = f"\u221a{_wrap(first)}"
            tex = tex[:m.start()] + replacement + tex[after:]
            continue
        if after >= len(tex) or tex[after] != "{":
            raise ValueError(f"\\frac with one argument in {tex!r}")
        second, after2 = _brace(tex, after)
        second = _expand_structural(second)
        tex = tex[:m.start()] + f"{_wrap(first)}/{_wrap(second)}" + tex[after2:]
    raise ValueError(f"nested too deeply: {tex!r}")


def to_unicode(tex: str) -> str:
    out = re.sub(r"\\mathbb\{([A-Z])\}", lambda m: BLACKBOARD.get(m.group(1), m.group(1)), tex)
    out = _expand_structural(out)
    for cmd in sorted(SYMBOLS, key=len, reverse=True):
        out = out.replace(cmd, SYMBOLS[cmd])
    out = re.sub(r"\^\{([0-9n]+)\}", lambda m: "".join(SUPERSCRIPT[c] for c in m.group(1)), out)
    out = re.sub(r"\^([0-9n])", lambda m: SUPERSCRIPT[m.group(1)], out)
    out = out.replace(r"\ ", " ").replace(r"\,", "\u2009").replace(r"\;", "\u2009")
    out = out.replace(r"\{", "{").replace(r"\}", "}")
    leftover = re.findall(r"\\[a-zA-Z]+", out)
    if leftover:
        raise ValueError(f"unhandled LaTeX {sorted(set(leftover))} in: {tex!r}")
    return out


def render_text(md: str) -> str:
    """Inline maths spans and bold, escaped everywhere else."""
    parts = re.split(r"(\$[^$]*\$)", md)
    rendered = []
    for part in parts:
        if part.startswith("$") and part.endswith("$") and len(part) > 1:
            rendered.append(f'<span class="m">{html.escape(to_unicode(part[1:-1]))}</span>')
        else:
            esc = html.escape(part)
            esc = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", esc)
            rendered.append(esc)
    return "".join(rendered)


def build(bundle: dict, queue: dict | None) -> str:
    sampled = set(queue.get("question_ids", [])) if queue else set()
    mc = {m["id"]: m for m in bundle.get("misconceptions", [])}
    cards = []

    for i, q in enumerate(bundle["questions"], 1):
        in_sample = q["id"] in sampled
        choices_html = ""
        if q.get("choices"):
            rows = []
            for c in q["choices"]:
                correct = c["key"] == q["correct_answer"]
                m = mc.get(c.get("misconception_id") or "")
                note = (f'<span class="mcnote">encodes: {html.escape(m["label"])}</span>'
                        if m else '<span class="mcnote dim">no misconception mapped</span>'
                        if not correct else "")
                rows.append(
                    f'<li class="{"ok" if correct else ""}">'
                    f'<span class="key">{html.escape(c["key"])}</span>'
                    f'<span class="ctext">{render_text(c["text"])}</span>'
                    f'{note}</li>'
                )
            choices_html = f'<ul class="choices">{"".join(rows)}</ul>'
        else:
            choices_html = (
                f'<p class="numeric">Numeric answer &middot; '
                f'<span class="m">{html.escape(to_unicode(str(q["correct_answer"])))}</span></p>'
            )

        steps = "".join(
            f'<li>{render_text(s["text_md"])}</li>' for s in q["canonical_solution"]
        )

        cards.append(f"""
<article class="q" id="{html.escape(q['id'])}">
  <header>
    <span class="n">{i:02d}</span>
    <span class="tier t-{html.escape(q['tier'])}">{html.escape(q['tier'])}</span>
    <span class="qid">{html.escape(q['id'])}</span>
    <span class="lo">{html.escape(q['lo_id'])} &middot; p.{q.get('source_page', '—')}</span>
    {'<span class="sampled">in the 10% sample</span>' if in_sample else ''}
  </header>
  <p class="stem">{render_text(q['stem'])}</p>
  {choices_html}
  <details>
    <summary>Worked solution &mdash; this is what the tutor teaches from</summary>
    <ol class="steps">{steps}</ol>
    <p class="derives">Derived from <code>{html.escape(q.get('parent_question_id') or '—')}</code>
       &middot; {html.escape(q.get('source_note') or '')}</p>
  </details>
  <div class="verdict" data-qid="{html.escape(q['id'])}">
    <button type="button" data-v="accept">Accept</button>
    <button type="button" data-v="reject">Reject</button>
    <button type="button" data-v="fix">Needs a fix</button>
    <span class="state" aria-live="polite"></span>
  </div>
</article>""")

    counts = {}
    for q in bundle["questions"]:
        counts[q["tier"]] = counts.get(q["tier"], 0) + 1
    tier_line = " &middot; ".join(f"{v} {k}" for k, v in sorted(counts.items()))

    return TEMPLATE.replace("{{CARDS}}", "".join(cards)) \
                   .replace("{{TOTAL}}", str(len(bundle["questions"]))) \
                   .replace("{{TIERS}}", tier_line) \
                   .replace("{{SAMPLED}}", str(len(sampled))) \
                   .replace("{{BUNDLE}}", html.escape(bundle.get("bundle", "bundle"))) \
                   .replace("{{GENERATOR}}", html.escape(bundle.get("generator", "—")))


TEMPLATE = Path(__file__).with_name("review_page_template.html").read_text()


# =============================================================================
# Review dossiers for Samuel's gates (B17; extraction-pipeline.md §3.13)
#
#   --gate g1   objectives with their evidence, per chapter           (after S1)
#   --gate g2   book questions: EVERY three-way disagreement, EVERY item with no
#               printed answer, and a seeded 10% sample of the rest    (after S3)
#   --gate g3   generated families and widgets: a seeded 10% sample stratified by
#               family, so every family is read at least once          (after S6/S7)
#   --gate g3-mappings   part of G3: EVERY widget mapping the blind verifier did not
#               confirm, held by decision 47 until kept or dropped      (after S7 verify)
#   --gate g4   misconceptions: the verifier's dropped count, and a seeded 10%
#               sample of the kept entries with their refutations      (after S5)
#
# Each page is ONE self-contained HTML file: inline CSS and script, no fonts or
# scripts fetched, readable on a phone. The values are the Noor Play tokens
# (docs/design/handoffs/noor-play/tokens.css, as published), copied in because a
# self-contained page cannot link them. Verdicts are kept in the browser
# (localStorage, best effort) and leave the page as JSON — "Copy verdicts" or
# "Download" — in the shape apply_review_verdicts.py reads for G3
# ({bundle, reviewer, verdicts: {id: verdict}}, plus notes), and the same shape
# for the other gates. The sample's seed and ids are printed on the page, so the
# draw can be reproduced.
# =============================================================================

import hashlib
import math
import random

DOSSIER_SYMBOLS = {**SYMBOLS, r"\infty": "\u221e", r"\leq": "\u2264", r"\geq": "\u2265",
                   r"\ne": "\u2260", r"\theta": "\u03b8", r"\alpha": "\u03b1", r"\beta": "\u03b2",
                   r"\Delta": "\u0394", r"\triangle": "\u25b3", r"\perp": "\u22a5",
                   r"\parallel": "\u2225", r"\quad": " ", r"\qquad": "  ", r"\ldots": "\u2026",
                   r"\dots": "\u2026", r"\hat": "", r"\degree": "\u00b0", r"\%": "%",
                   r"\notin": "\u2209", r"\therefore": "\u2234", r"\mid": "|"}


def tex_html(tex: str) -> str:
    """LaTeX -> readable HTML (sub/superscripts as tags). Falls back to the raw source,
    marked as such, rather than failing the page or showing a half-converted formula. An aligned
    derivation is read line by line (its `&` is alignment, its `\\\\` a new line)."""
    env = re.fullmatch(r"\s*\\begin\{(align\*?|aligned)\}(.*)\\end\{\1\}\s*", tex, re.S)
    if env:
        lines = [x.replace("&", "").strip() for x in env.group(2).split("\\\\")]
        return "<br>".join(tex_html(x) for x in lines if x)
    try:
        out = re.sub(r"\\(?:text|mathrm|textrm|mbox)\{([^{}]*)\}", r"\1", tex)
        out = out.replace(r"\dfrac", r"\frac").replace(r"\tfrac", r"\frac")
        out = re.sub(r"\\mathbb\{([A-Z])\}", lambda m: BLACKBOARD.get(m.group(1), m.group(1)), out)
        out = _expand_structural(out)
        for cmd in sorted(DOSSIER_SYMBOLS, key=len, reverse=True):
            out = out.replace(cmd, DOSSIER_SYMBOLS[cmd])
        out = out.replace(r"\ ", " ").replace(r"\,", "\u2009").replace(r"\;", "\u2009")
        out = out.replace(r"\{", "{").replace(r"\}", "}")
        if re.search(r"\\[a-zA-Z]+", out):
            raise ValueError("unhandled")
        esc = html.escape(out)
        esc = re.sub(r"\^\{([^{}]*)\}", r"<sup>\1</sup>", esc)
        esc = re.sub(r"\^(.)", r"<sup>\1</sup>", esc)
        esc = re.sub(r"_\{([^{}]*)\}", r"<sub>\1</sub>", esc)
        esc = re.sub(r"_(.)", r"<sub>\1</sub>", esc)
        return f'<span class="m">{esc.replace("{", "").replace("}", "")}</span>'
    except ValueError:
        return f'<code class="tex" title="raw LaTeX">{html.escape(tex)}</code>'


def md_html(md: str | None) -> str:
    if not md:
        return ""
    parts = re.split(r"(\$[^$]*\$)", str(md))
    out = []
    for part in parts:
        if len(part) > 1 and part.startswith("$") and part.endswith("$"):
            out.append(tex_html(part[1:-1]))
        else:
            esc = html.escape(part)
            out.append(re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", esc))
    return "".join(out)


def steps_html(steps) -> str:
    items = [s.get("text_md", "") if isinstance(s, dict) else s for s in steps or []]
    return "<ol class=\"steps\">" + "".join(f"<li>{md_html(t)}</li>" for t in items) + "</ol>"


def seeded_sample(ids_by_stratum: dict[str, list[str]], percent: float, seed: int) -> list[str]:
    """One per stratum first, then the rest at random up to ceil(percent% of all)."""
    rng = random.Random(seed)
    all_ids = [i for ids in ids_by_stratum.values() for i in ids]
    if not all_ids:
        return []
    picked = [rng.choice(sorted(ids)) for _, ids in sorted(ids_by_stratum.items()) if ids]
    target = max(len(picked), math.ceil(len(all_ids) * percent / 100))
    rest = sorted(set(all_ids) - set(picked))
    rng.shuffle(rest)
    return sorted(set(picked) | set(rest[: max(0, target - len(picked))]))


PAGE_CSS = """
:root{--play-bg-page:#FFF6E6;--play-bg-surface:#FFFFFF;--play-bg-warm:#FFE9BD;--play-ink:#241F3D;
--play-text-dim:#4A4266;--play-text-muted:#5A5570;--play-text-label:#615B7D;--play-text-link:#136386;
--play-action:#F0A22F;--play-on-action:#241F3D;--play-mastery:#2F9E8F;--play-on-mastery:#241F3D;
--play-celebrate:#7B4FC9;--play-on-celebrate:#FFFFFF;--play-sky:#7FD1F0;--play-on-sky:#0F3D51;
--play-berry:#FFA8C5;--play-on-berry:#7A2447;--play-leaf:#B6E88F;--play-on-leaf:#1F3D12;
--play-text-amber:#A34F0A;--play-inactive-fill:#F6F5FA;--play-inactive-border:#9890B5;
--play-stroke:3px;--play-stroke-sm:2.5px;--play-shadow:4px 4px 0 var(--play-ink);
--play-shadow-sm:3px 3px 0 var(--play-ink);--play-radius-sm:14px;--play-radius:20px;
--play-radius-lg:28px;--play-radius-pill:999px;--play-target-min:52px;
--play-font-display:"Baloo Bhaijaan 2","Baloo 2",system-ui,sans-serif;
--play-font-read:"Cairo",system-ui,sans-serif;--play-font-mono:"IBM Plex Mono",ui-monospace,monospace;
--play-text-title:1.5rem;--play-text-ui:1.15rem;--play-text-label-size:.85rem;--play-text-read:1rem;
--play-text-data:.72rem;--play-leading-latin:1.75;--play-press:90ms cubic-bezier(.2,.7,.3,1)}
*{box-sizing:border-box}
body{margin:0;background:var(--play-bg-page);color:var(--play-ink);font-family:var(--play-font-read);
font-size:var(--play-text-read);line-height:var(--play-leading-latin);-webkit-text-size-adjust:100%}
.shell{max-width:860px;margin:0 auto;padding:0 16px}
header.top{background:var(--play-bg-warm);border-bottom:var(--play-stroke) solid var(--play-ink);padding:24px 0 20px}
h1,h2,h3{font-family:var(--play-font-display);font-weight:800;line-height:1.2;margin:0}
h1{font-size:clamp(1.4rem,5vw,var(--play-text-title))}
h2{font-size:var(--play-text-ui);margin:28px 0 8px}
.meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-family:var(--play-font-mono);
font-size:var(--play-text-data);color:var(--play-text-dim)}
.brief{margin:18px 0 0;color:var(--play-text-dim)}
.brief p{margin:0 0 8px}
.card{background:var(--play-bg-surface);border:var(--play-stroke) solid var(--play-ink);
border-radius:var(--play-radius);box-shadow:var(--play-shadow);padding:16px;margin:18px 0}
.card header{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-bottom:8px}
.id{font-family:var(--play-font-mono);font-size:var(--play-text-data);color:var(--play-text-label);
overflow-wrap:anywhere}
.tag{font-family:var(--play-font-mono);font-size:var(--play-text-data);padding:2px 10px;
border-radius:var(--play-radius-pill);border:var(--play-stroke-sm) solid var(--play-ink)}
.tag.attention{background:var(--play-action);color:var(--play-on-action)}
.tag.ok{background:var(--play-mastery);color:var(--play-on-mastery)}
.tag.info{background:var(--play-sky);color:var(--play-on-sky)}
.tag.sample{background:var(--play-celebrate);color:var(--play-on-celebrate)}
.tag.plain{background:var(--play-inactive-fill);color:var(--play-text-muted);border-color:var(--play-inactive-border)}
.stem{font-size:1.05rem;margin:4px 0 10px}
.m{font-family:var(--play-font-mono);font-size:.95em;unicode-bidi:isolate;direction:ltr}
code.tex{font-family:var(--play-font-mono);font-size:.85em;background:var(--play-inactive-fill);
border-radius:6px;padding:0 4px;overflow-wrap:anywhere}
table.answers{border-collapse:collapse;width:100%;margin:8px 0;font-size:.95rem}
table.answers th,table.answers td{text-align:start;padding:6px 8px;border-bottom:1px solid var(--play-inactive-border);vertical-align:top}
table.answers tr.disagree td{background:var(--play-bg-warm)}
ul.list,ol.steps{margin:6px 0;padding-inline-start:22px}
ul.choices{list-style:none;padding:0;margin:6px 0;display:grid;gap:6px}
ul.choices li{padding:8px 10px;border-radius:var(--play-radius-sm);border:var(--play-stroke-sm) solid var(--play-inactive-border);background:var(--play-inactive-fill)}
ul.choices li.key{border-color:var(--play-ink);background:var(--play-leaf);color:var(--play-on-leaf)}
.note{font-size:.9rem;color:var(--play-text-dim)}
.advice{border-inline-start:var(--play-stroke) solid var(--play-sky);padding:4px 10px;margin:8px 0;background:var(--play-bg-warm)}
details{margin-top:8px}
summary{cursor:pointer;color:var(--play-text-link);min-height:32px}
.verdict{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center}
.verdict button{font-family:var(--play-font-display);font-weight:700;font-size:1rem;min-height:var(--play-target-min);
min-width:var(--play-target-min);padding:0 16px;border-radius:var(--play-radius);border:var(--play-stroke) solid var(--play-ink);
background:var(--play-bg-surface);color:var(--play-ink);box-shadow:var(--play-shadow-sm);cursor:pointer;
transition:transform var(--play-press),box-shadow var(--play-press)}
.verdict button:active{transform:translate(3px,3px);box-shadow:0 0 0 var(--play-ink)}
.verdict button[aria-pressed="true"]{background:var(--play-action);color:var(--play-on-action)}
.verdict button:focus-visible,textarea:focus-visible,input:focus-visible{outline:var(--play-stroke) solid var(--play-text-link);outline-offset:2px}
textarea,input[type=text]{width:100%;font:inherit;border:var(--play-stroke-sm) solid var(--play-ink);border-radius:var(--play-radius-sm);
padding:8px;background:var(--play-bg-surface);color:var(--play-ink);margin-top:8px}
footer.bar{position:sticky;bottom:0;background:var(--play-bg-warm);border-top:var(--play-stroke) solid var(--play-ink);padding:10px 0;margin-top:24px}
footer.bar .shell{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
footer.bar .count{font-family:var(--play-font-mono);font-size:var(--play-text-data);margin-inline-end:auto}
.stat{display:inline-block;margin-inline-end:18px}
.stat b{font-family:var(--play-font-display);font-size:1.4rem}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
"""

PAGE_JS = r"""
(() => {
  const PAGE = document.body.dataset.page, GATE = document.body.dataset.gate;
  const KEY = 'review:' + PAGE;
  let state = {reviewer: '', verdicts: {}, notes: {}};
  try { state = Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} };
  const boxes = [...document.querySelectorAll('.verdict[data-id]')];
  const count = document.querySelector('.count');
  const paint = () => {
    boxes.forEach((b) => b.querySelectorAll('button').forEach((x) =>
      x.setAttribute('aria-pressed', String(state.verdicts[b.dataset.id] === x.dataset.v))));
    const n = boxes.filter((b) => state.verdicts[b.dataset.id]).length;
    if (count) count.textContent = n + ' of ' + boxes.length + ' decided';
  };
  boxes.forEach((b) => {
    b.querySelectorAll('button').forEach((x) => x.addEventListener('click', () => {
      state.verdicts[b.dataset.id] = x.dataset.v; save(); paint(); }));
    const t = b.parentElement.querySelector('textarea');
    if (t) { t.value = state.notes[b.dataset.id] || '';
             t.addEventListener('input', () => { state.notes[b.dataset.id] = t.value; save(); }); }
  });
  const who = document.querySelector('#reviewer');
  if (who) { who.value = state.reviewer || '';
             who.addEventListener('input', () => { state.reviewer = who.value; save(); }); }
  const doc = () => JSON.stringify(Object.assign(JSON.parse(document.querySelector('#meta').textContent),
    {reviewer: state.reviewer, verdicts: state.verdicts, notes: state.notes}), null, 2);
  const status = document.querySelector('.status');
  document.querySelector('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(doc()); status.textContent = 'copied'; }
    catch (_) { status.textContent = 'copy failed — use Download'; }
  });
  document.querySelector('#download').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([doc()], {type: 'application/json'}));
    a.download = PAGE + '.verdicts.json'; a.click(); URL.revokeObjectURL(a.href);
  });
  paint();
})();
"""


def verdict_box(item_id: str, options: list[tuple[str, str]]) -> str:
    buttons = "".join(f'<button type="button" data-v="{v}" aria-pressed="false">{html.escape(label)}'
                      f'</button>' for v, label in options)
    return (f'<div class="verdict" data-id="{html.escape(item_id)}" role="group" '
            f'aria-label="Verdict for {html.escape(item_id)}">{buttons}</div>'
            f'<textarea rows="2" aria-label="Note on {html.escape(item_id)}" '
            f'placeholder="Note (optional)"></textarea>')


def page(gate: str, title: str, meta_lines: list[str], brief: list[str], cards: list[str],
         meta: dict) -> str:
    body = "".join(cards)
    page_id = f"{gate}-" + hashlib.sha256((title + body).encode()).hexdigest()[:12]
    meta = {"gate": gate.upper(), "page": page_id, **meta}
    return f"""<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>{PAGE_CSS}</style>
</head>
<body data-page="{page_id}" data-gate="{gate}">
<header class="top"><div class="shell">
<h1>{html.escape(title)}</h1>
<div class="meta">{''.join(f'<span>{m}</span>' for m in meta_lines)}</div>
<div class="brief">{''.join(f'<p>{b}</p>' for b in brief)}</div>
<label for="reviewer" class="note">Reviewer (your name goes on every verdict)</label>
<input id="reviewer" type="text" autocomplete="name">
</div></header>
<main class="shell">{body}</main>
<footer class="bar"><div class="shell">
<span class="count"></span><span class="status note" aria-live="polite"></span>
<div class="verdict" style="margin:0"><button type="button" id="copy">Copy verdicts</button>
<button type="button" id="download">Download</button></div>
</div></footer>
<script type="application/json" id="meta">{json.dumps(meta, ensure_ascii=False).replace("</", "<\\/")}</script>
<script>{PAGE_JS}</script>
</body>
</html>
"""


# ---- G1: objectives ----------------------------------------------------------
def dossier_g1(book, manifest: dict, objectives_dir: Path, chapters: set[int] | None) -> str:
    from assemble_lesson_bundle import ObjectivesFile, book_lesson, manifest_lessons
    cards, n_obj, n_single, n_rule = [], 0, 0, 0
    current = None
    for mod, les in manifest_lessons(manifest):
        if chapters and mod["chapter"] not in chapters:
            continue
        if current != mod["id"]:
            cards.append(f"<h2>Chapter {mod['chapter']} — {html.escape(mod['title'])}</h2>")
            current = mod["id"]
        prov = book_lesson(mod, les)
        where = ", ".join(f"{s.number} {s.title}" for s in prov.sections)
        part = f" · part {prov.part.n} of {prov.part.of}" if prov.part else ""
        intro = " · chapter introduction" if prov.chapter_intro else ""
        p = objectives_dir / f"{prov.slug}.json"
        if not p.exists():
            cards.append(f'<div class="card"><header><span class="tag attention">missing</span>'
                         f'<span class="id">{prov.slug}</span></header><p>No objectives file.</p></div>')
            continue
        of = ObjectivesFile.model_validate_json(p.read_text())
        for o in of.objectives:
            n_obj += 1
            extra = o.model_extra or {}
            conf = extra.get("confidence", "—")
            kinds = {e.kind for e in o.evidence}
            rule_ok = len(kinds) >= 2 and bool(kinds & {"worked_example", "exercise"})
            n_single += conf == "single"
            n_rule += not rule_ok
            tags = (f'<span class="tag {"attention" if conf == "single" else "ok"}">{html.escape(str(conf))}</span>'
                    + ("" if rule_ok else '<span class="tag attention">evidence rule fails</span>'))
            ev = "".join(f"<li><b>{html.escape(e.kind)}</b> · {html.escape(e.anchor)} · p.{e.printed_page}"
                         + (f" — “{html.escape(e.quote)}”" if e.quote else "") + "</li>"
                         for e in o.evidence)
            prereq = [pr.src for pr in of.prerequisites if pr.dst == o.id]
            cards.append(f"""<article class="card"><header>{tags}<span class="id">{o.id}</span></header>
<p class="note">{html.escape(prov.title)} · {html.escape(where)}{part}{intro}</p>
<h3>{html.escape(o.label)}</h3><p class="stem">{md_html(o.statement)}</p>
<details open><summary>Evidence ({len(o.evidence)}, {len(kinds)} kind(s))</summary><ul class="list">{ev}</ul></details>
<details><summary>Exercise items mapped here ({len(o.exercise_items)})</summary>
<p class="id">{html.escape(', '.join(o.exercise_items) or 'none')}</p></details>
{f'<p class="note">Prerequisites: {html.escape(", ".join(prereq))}</p>' if prereq else ''}
{verdict_box(o.id, [("approve", "Approve"), ("edit", "Edit"), ("drop", "Drop")])}</article>""")
    return page("g1", f"G1 · Objectives — {book.book}",
                [f"<b>{n_obj}</b> objectives", f"<b>{n_single}</b> found by one finder only",
                 f"<b>{n_rule}</b> failing the evidence rule",
                 f"chapters {', '.join(map(str, sorted(chapters))) if chapters else 'all'}"],
                ["Each objective is derived from the book, not copied from an objectives box "
                 "(extraction-pipeline.md §3.4). Check that it is something the book teaches and "
                 "practises, in the book's own words, at the right grain (2–5 per lesson).",
                 "<b>single</b> means only one of the two blind finders found it; an amber evidence "
                 "tag means it lacks two kinds of evidence including a worked example or exercise. "
                 "Approve, edit (say how in the note) or drop."],
                cards, {"book": book.book, "chapters": sorted(chapters) if chapters else "all"})


# ---- G2: book questions ------------------------------------------------------
def dossier_g2(book, manifest: dict, runs_dir: Path, chapters: set[int] | None,
               percent: float, seed: int, recommend: dict | None = None) -> str:
    """Every disagreement, every item with no printed answer, every item whose typing G2 must fix,
    every item a recommendation names, and a seeded sample of the rest. With `recommend` (a
    verdicts file in G2's own shape, unsigned: {items: {key: {verdict, class, note, fields}}}) each
    card shows the recommended verdict and the exact fields a fix would change — a recommendation,
    never a verdict: the reviewer's buttons start empty."""
    from assemble_lesson_bundle import LessonRun, manifest_lessons
    recs = (recommend or {}).get("items") or {}
    must, rest, items, drafts = [], defaultdict(list), {}, set()
    for mod, les in manifest_lessons(manifest):
        if chapters and mod["chapter"] not in chapters:
            continue
        p = runs_dir / f"{les['id']}.json"
        if not p.exists():
            continue
        run = LessonRun.model_validate_json(p.read_text())
        if (run.model_extra or {}).get("draft"):
            drafts.add(les["id"])
        for it in run.items:
            key = f"{les['id']}:{it.ref}"
            items[key] = (les, it)
            extra = it.model_extra or {}
            if it.verification in ("disputed", "no_printed_answer") or extra.get("typing_problems") or key in recs:
                must.append(key)
            else:
                rest[les["id"]].append(key)
    sample = seeded_sample(rest, percent, seed)
    shown = must + sample
    cards = []
    for key in shown:
        les, it = items[key]
        extra = it.model_extra or {}
        ver = extra.get("verify") or {}
        why = ("disagreement" if it.verification == "disputed" else
               "no printed answer" if it.verification == "no_printed_answer" else
               "typing" if extra.get("typing_problems") else
               "named" if key in recs else "sample")
        rows_ = [("Printed answer", it.printed_answer), ("EPUB solution's answer", it.epub_final_answer),
                 ("Blind re-solve", it.blind_answer)]
        vals = {v for _, v in rows_ if v}
        cls = "disagree" if len(vals) > 1 else ""
        table = "".join(f'<tr class="{cls}"><th>{k}</th><td>{md_html("$" + v + "$") if v else "—"}</td></tr>'
                        for k, v in rows_)
        checks = "".join(
            f'<li><b>{html.escape(p["pair_id"].split("|")[-1])}</b> · {html.escape(str(p.get("route")))} · '
            f'{html.escape(str(p.get("verdict")))}' + (f' — {html.escape(p["reason"])}' if p.get("reason") else "") + "</li>"
            for p in ver.get("pairs") or [])
        flags = "".join(f'<p class="note"><b>{html.escape(lbl)}</b> {html.escape(txt)}</p>' for lbl, txt in (
            [("Typing:", "; ".join(extra.get("typing_problems") or []))] if extra.get("typing_problems") else []) + (
            [("Unchecked:", "; ".join(ver.get("unchecked") or []))] if ver.get("unchecked") else []) + (
            [("Judge:", ver["inconsistent"])] if ver.get("inconsistent") else []))
        choices = ""
        if it.choices:
            choices = '<ul class="choices">' + "".join(
                f'<li class="{"key" if c.get("key") == it.answer else ""}">{html.escape(str(c.get("key")))}. '
                f'{md_html(c.get("text"))}</li>' for c in it.choices) + "</ul>"
        marker = (f'<p class="note">Marked as <b>{html.escape(it.marker.get("kind", ""))}</b>'
                  + (f', form: {html.escape(str(it.marker.get("form")))}' if it.marker.get("form") else "")
                  + f' · key {md_html("$" + it.marker.get("key", "") + "$")}</p>') if it.marker else ""
        prior = (f'<p class="note">Already at G2: {html.escape(it.g2.verdict)} by {html.escape(it.g2.by)}'
                 + (f' — {html.escape(it.g2.note)}' if it.g2.note else "") + "</p>") if it.g2 else ""
        r = recs.get(key)
        advice = ""
        if r:
            fields = r.get("fields") or {}
            shown_fields = "".join(
                f'<li><b>{html.escape(k)}</b>: ' + (steps_html(v) if k == "solution" else
                                                    html.escape(json.dumps(v, ensure_ascii=False))) + "</li>"
                for k, v in fields.items())
            advice = (f'<div class="advice"><p><span class="tag plain">recommended</span> <b>{html.escape(r["verdict"])}</b>'
                      f' · {html.escape(r.get("class", ""))}'
                      + (' <span class="tag attention">low confidence — your call</span>' if r.get("confidence") == "low" else "")
                      + f'</p><p>{html.escape(r.get("note", ""))}</p>'
                      + (f'<p class="note"><b>Why it is your call:</b> {html.escape(r["why_low"])}</p>' if r.get("why_low") else "")
                      + (f'<details><summary>What the fix changes ({len(fields)})</summary><ul class="list">{shown_fields}</ul></details>'
                         if fields else "") + "</div>")
        tag = {"disagreement": "attention", "no printed answer": "info", "typing": "attention",
               "named": "info", "sample": "sample"}[why]
        cards.append(f"""<article class="card"><header><span class="tag {tag}">{why}</span>
<span class="tag plain">{html.escape(it.answer_type)}</span><span class="tag plain">{html.escape(it.tier)}</span>
<span class="id">{html.escape(key)} · p.{it.printed_page}</span></header>
<p class="stem">{md_html(it.stem)}</p>{choices}{marker}
<table class="answers">{table}</table>
{f'<details open><summary>The checks</summary><ul class="list">{checks}</ul></details>' if checks else ''}{flags}
<details {'open' if why != 'sample' else ''}><summary>Canonical solution ({html.escape(it.solution_provenance)})</summary>{steps_html(it.solution)}</details>
{advice}{prior}{verdict_box(key, [("accept", "Accept"), ("fix", "Fix"), ("exclude", "Exclude"), ("hold", "Hold")])}</article>""")
    n_dis = sum(1 for k in must if items[k][1].verification == "disputed")
    n_npa = sum(1 for k in must if items[k][1].verification == "no_printed_answer")
    brief = ["Every book question is checked three ways: the printed answer, the EPUB worked "
             "solution's final answer and a blind re-solve (FR-4302). Where they disagree the "
             "row is highlighted. Books have errata: nothing here was corrected silently.",
             "Accept keeps the item as the book gives it; Fix means the note says what to change; "
             "Exclude drops it with a reason; Hold keeps it out of the live set for now."]
    if recs:
        n_low = sum(1 for k in must if (recs.get(k) or {}).get("confidence") == "low")
        if n_low:
            brief.append(f"<b>{n_low}</b> recommendation(s) are marked <b>low confidence — your call</b>: "
                         "the mathematics is checked, the choice between verdicts is a content decision.")
        brief.append("Each card shows a <b>recommended</b> verdict with its reason and, for a fix, the exact "
                     "fields it would change. It is a recommendation, not a verdict: your buttons start empty. "
                     "Choosing Fix with an empty note takes the recommended fields.")
    if drafts:
        brief.append(f"<b>DRAFT</b> run files ({', '.join(sorted(drafts))}): split before G2 ruled on their "
                     "typing, for this page only. Assembly never reads them.")
    return page("g2", f"G2 · Book questions — {book.book}",
                [f"<b>{n_dis}</b> disagreements", f"<b>{n_npa}</b> without a printed answer",
                 f"<b>{len(must) - n_dis - n_npa}</b> with typing to fix or named",
                 f"<b>{len(sample)}</b> sampled of {sum(len(v) for v in rest.values())} agreed "
                 f"({percent:g}%, seed {seed}, at least one per lesson)"],
                brief, cards, {"book": book.book, "seed": seed, "sample_percent": percent,
                               "sampled": sample, "must_review": must, "draft": sorted(drafts)})


def g2_file(export: dict, recommend: dict | None) -> tuple[dict, list[str]]:
    """The page's export ({reviewer, verdicts, notes}) -> G2's verdicts file ({by, items: {key:
    {verdict, note, fields}}}), which `assemble_objectives.py lesson-runs --g2` and
    `apply_review_verdicts.py --g2` read. A Fix with an empty note takes the recommendation's
    fields when the recommendation was a fix; a Fix with a note carries no fields (the note says
    what to change, and someone must write them) and is listed. Nothing is signed without a name."""
    by = (export.get("reviewer") or "").strip()
    if not by:
        raise ValueError("the export names no reviewer: an unattributed review is not a review")
    recs = (recommend or {}).get("items") or {}
    items, todo = {}, []
    for key, verdict in sorted((export.get("verdicts") or {}).items()):
        note = ((export.get("notes") or {}).get(key) or "").strip()
        entry = {"verdict": verdict, **({"note": note} if note else {})}
        r = recs.get(key) or {}
        if verdict == "fix":
            if not note and r.get("verdict") == "fix" and r.get("fields"):
                entry["fields"] = r["fields"]
                entry["note"] = "as recommended: " + r.get("note", "")
            else:
                todo.append(f"{key}: Fix with {'a note' if note else 'no note and no recommended fields'} — write its fields")
        items[key] = entry
    return {"by": by, "items": items}, todo


# ---- G3: generated families and widgets --------------------------------------
def family_of(q: dict) -> str:
    if q.get("family"):
        return q["family"]
    note = q.get("source_note") or ""
    return (note.split("template family ", 1)[1].rstrip(". ") if "template family " in note
            else f"(no family) {q['id']}")


def dossier_g3(bundles: list[dict], catalogue: dict | None, percent: float, seed: int,
               queue: dict | None, flags: dict | None = None) -> str:
    """`flags` ({family id: note}, --flags): what the pipeline already asks the reviewer to look at in a family
    — e.g. a tier that no longer fits after a re-author. Shown on every sampled item of that family, and a
    flagged family is always in the sample (every family is)."""
    flags = flags or {}
    qs = {q["id"]: q for b in bundles for q in b.get("questions", [])}
    mc = {m["id"]: m for m in (catalogue or {}).get("misconceptions", [])}
    fams: dict[str, list[str]] = defaultdict(list)
    for q in qs.values():
        fams[family_of(q)].append(q["id"])
    picked = sorted(set(queue["question_ids"]) & set(qs)) if queue else seeded_sample(fams, percent, seed)
    cards = []
    for qid in picked:
        q = qs[qid]
        ch = q.get("choices")
        body = ""
        if isinstance(ch, list):
            body = '<ul class="choices">' + "".join(
                f'<li class="{"key" if c["key"] == q["correct_answer"] else ""}">{html.escape(c["key"])}. '
                f'{md_html(c["text"])}'
                + (f'<br><span class="note">encodes: {html.escape(mc[c["misconception_id"]]["label"])}</span>'
                   if c.get("misconception_id") in mc else
                   f'<br><span class="note">names {html.escape(c["misconception_id"])} — NOT IN THE CATALOGUE</span>'
                   if c.get("misconception_id") else "")
                + "</li>" for c in ch) + "</ul>"
        elif isinstance(ch, dict) and "kind" in ch:
            diags = "".join(
                f"<li><b>{html.escape(d.get('predicate', ''))}</b> → "
                + (html.escape(mc[d["misconception_id"]]["label"]) if d.get("misconception_id") in mc
                   else html.escape(str(d.get("misconception_id"))) + " — NOT IN THE CATALOGUE")
                + "</li>" for d in ch.get("diagnostics") or [])
            body = (f'<p class="note">Widget <b>{html.escape(ch["kind"])}</b></p>'
                    f'<pre class="note" style="white-space:pre-wrap;overflow-wrap:anywhere">'
                    f'{html.escape(json.dumps(ch.get("spec"), ensure_ascii=False))}</pre>'
                    f'<p class="note">Wrong constructions it diagnoses:</p><ul class="list">{diags}</ul>')
        else:
            body = f'<p class="note">Answer: {md_html("$" + str(q["correct_answer"]) + "$")}</p>'
        flag = flags.get(family_of(q))
        body = (f'<p class="advice"><span class="tag attention">flagged</span> {html.escape(flag)}</p>' if flag else "") + body
        cards.append(f"""<article class="card"><header><span class="tag sample">{html.escape(family_of(q))}</span>
<span class="tag plain">{html.escape(q["question_type"])}</span><span class="tag plain">{html.escape(q["tier"])}</span>
<span class="id">{html.escape(qid)}</span></header>
<p class="stem">{md_html(q["stem"])}</p>{body}
<details><summary>Worked solution — what the tutor teaches from</summary>{steps_html(q.get("canonical_solution"))}
<p class="note">Parent book question: {html.escape(q.get("parent_question_id") or "—")}</p></details>
{verdict_box(qid, [("accept", "Accept"), ("fix", "Needs a fix"), ("reject", "Reject family")])}</article>""")
    return page("g3", "G3 · Generated families and widgets",
                [f"<b>{len(picked)}</b> sampled of {len(qs)}", f"<b>{len(fams)}</b> families, every one read",
                 f"seed {seed}" if not queue else "sample from the load's review queue"],
                ["One item per family, then more at random to reach the sample size (ADR-0008). A "
                 "verdict travels to the item's family: Reject retires the whole family, Needs a fix "
                 "pulls back the item only (apply_review_verdicts.py).",
                 "Check the answer key against the worked solution, and that each distractor or "
                 "widget diagnosis is really the mistake its misconception names."],
                cards, {"bundle": ", ".join(b.get("bundle", "") or "generated" for b in bundles),
                        "seed": seed, "sample_percent": percent, "sampled": picked})


# ---- G4: misconceptions ------------------------------------------------------
# ---- G3, widget mappings held for review (decision 47) -------------------------
def dossier_g3_mappings(queue: dict, source: str) -> str:
    """Every mapping the blind S7 verifier did not confirm (generate_widget_questions.py --pending-review): the
    widget's stem, what the verifier read off it, the claim, the verifier's reason, and keep / drop. Not a
    sample — each held claim is inactive until a human decides it. The export is the --mapping-review file:
    keep turns the mapping on, drop deletes it."""
    items = queue.get("items") or []
    cards = []
    for it in items:
        reading = it.get("reading")
        cards.append(f"""<article class="card"><header><span class="tag sample">{html.escape(it.get("template_id") or "")}</span>
<span class="tag plain">{html.escape(it.get("kind") or "")}</span><span class="id">{html.escape(it["key"])}</span></header>
<p class="stem">{md_html(it.get("stem"))}</p>
<p class="note">What the blind checker read off the question:</p>
<pre class="note" style="white-space:pre-wrap;overflow-wrap:anywhere">{html.escape(json.dumps(reading, ensure_ascii=False))}</pre>
<p><span class="tag info">claim</span> a student whose construction fires <b>{html.escape(it["predicate"])}</b>
{f'(“{html.escape(it["predicate_meaning"])}”)' if it.get("predicate_meaning") else ""} holds
<b>{md_html(it.get("misconception_label") or it["misconception_id"])}</b></p>
{f'<p class="note">{md_html(it["misconception_description"])}</p>' if it.get("misconception_description") else ""}
<p class="advice"><span class="tag attention">checker refused</span> {md_html(it.get("why") or "no verdict")}</p>
<details><summary>How the checker built a correct answer</summary><p class="note">{md_html(it.get("construction") or "—")}</p></details>
{verdict_box(it["key"], [("keep", "Keep the claim"), ("drop", "Drop it")])}</article>""")
    by_tpl = Counter(it.get("template_id") for it in items)
    return page("g3", "G3 · Widget diagnoses held for review",
                [f"<b>{len(items)}</b> held claim(s)", f"<b>{len(by_tpl)}</b> widget template(s)", "every one, no sample"],
                ["Decision 47: a claim that a wrong construction reveals a named misconception, which the blind "
                 "checker did not confirm, is held — the widget still marks right and wrong, but never names that "
                 "misconception to a student and S5 never uses it as evidence — until you decide it.",
                 "Keep a claim only if a student holding that misconception would build exactly what fires the "
                 "predicate, on this question's numbers. Drop it if the predicate would mostly fire for another "
                 "reason, or never for this error. A dropped claim is deleted; the widget stays."],
                cards, {"bundle": source, "format": queue.get("format"), "held": len(items),
                        "sampled": [it["key"] for it in items]})


def dossier_g4(catalogue: dict, s5_runs: list[dict], percent: float, seed: int) -> str:
    entries = catalogue.get("misconceptions", [])
    dropped = [d for run in s5_runs for r in run.get("records") or [] for d in r.get("dropped") or []]
    kept_by_runs = sum((run.get("totals") or {}).get("entries", 0) for run in s5_runs)
    verdicts = Counter(d.get("verdict") or "NO_VERDICT" for d in dropped)
    by_kind: dict[str, list[str]] = defaultdict(list)
    for m in entries:
        by_kind[m.get("kind") or "?"].append(m["id"])
    picked = seeded_sample(by_kind, percent, seed)
    by_id = {m["id"]: m for m in entries}
    cards = [f"""<section class="card"><h3>What the verifier dropped</h3>
<p><span class="stat"><b>{len(dropped)}</b> dropped</span>
<span class="stat"><b>{kept_by_runs}</b> kept by the S5 run(s)</span>
<span class="stat"><b>{len(entries)}</b> in the catalogue</span></p>
<p class="note">{', '.join(f'{html.escape(k)} {v}' for k, v in sorted(verdicts.items())) or 'nothing dropped'}.
A dropped entry never ships; only the count is shown here (§3.13).</p></section>"""]
    for mid in picked:
        m = by_id[mid]
        maps = "".join(f"<li>{html.escape(x.get('question_id', ''))}: “{md_html(x.get('choice_text'))}”</li>"
                       for x in m.get("maps") or [])
        cards.append(f"""<article class="card"><header><span class="tag info">{html.escape(m.get('kind') or '?')}</span>
<span class="id">{html.escape(mid)}</span></header>
<h3>{md_html(m['label'])}</h3><p class="stem">{md_html(m['description'])}</p>
{f'<p class="note">Signal: {md_html(m["signal"])}</p>' if m.get('signal') else ''}
<details open><summary>Refutation</summary>{steps_html(m.get('refutation'))}</details>
{f'<details><summary>Book options it is stamped on ({len(m["maps"])})</summary><ul class="list">{maps}</ul></details>' if m.get('maps') else ''}
{f'<p class="note">Aliases: {html.escape(", ".join(m["aliases"]))}</p>' if m.get('aliases') else ''}
{verdict_box(mid, [("accept", "Accept"), ("send_back", "Send back")])}</article>""")
    return page("g4", f"G4 · Misconceptions — {catalogue.get('catalogue') or catalogue.get('course_id') or 'catalogue'}",
                [f"<b>{len(dropped)}</b> dropped by the verifier", f"<b>{len(picked)}</b> of {len(entries)} kept entries sampled",
                 f"{percent:g}%, seed {seed}, at least one per kind"],
                ["Each refutation was worked by a second agent against the canonical solutions and "
                 "kept only when CONFIRMED (fail-closed). Read the sample for the house style: step 1 "
                 "names the student's thinking without calling it wrong-headed, the last step leaves "
                 "them with the move that works, and nothing corrects them with a convention the book "
                 "does not teach (FR-1114)."],
                cards, {"catalogue": catalogue.get("catalogue"), "course_id": catalogue.get("course_id"),
                        "seed": seed, "sample_percent": percent, "sampled": picked,
                        "dropped": len(dropped)})


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("bundle", type=Path, nargs="?",
                    help="(legacy G3 page) a generated question bundle")
    ap.add_argument("--gate", choices=["g1", "g2", "g3", "g3-mappings", "g4"],
                    help="write a gate dossier instead of the legacy G3 page")
    ap.add_argument("--book", help="g1/g2: the book (name or config path)")
    ap.add_argument("--chapter", type=int, action="append")
    ap.add_argument("--manifest", type=Path)
    ap.add_argument("--objectives", type=Path)
    ap.add_argument("--runs", type=Path)
    ap.add_argument("--bundles", type=Path, action="append", default=[],
                    help="g3: generated and widget question bundles")
    ap.add_argument("--catalogue", type=Path, help="g3/g4: the misconception catalogue")
    ap.add_argument("--s5", type=Path, action="append", default=[], help="g4: S5 final run output(s)")
    ap.add_argument("--sample", type=float, default=10)
    ap.add_argument("--seed", type=int, default=20260925)
    ap.add_argument("--queue", type=Path, help="the *.review-queue.json written at load time")
    ap.add_argument("--mappings", type=Path, help="g3-mappings: the held-mapping queue (--pending-review)")
    ap.add_argument("--flags", type=Path, help='g3: {"flags": {family id: note}} — a family the reviewer must look at')
    ap.add_argument("--recommend", type=Path, help="g2: recommended verdicts ({items: {key: {verdict, class, note, fields}}})")
    ap.add_argument("--export", type=Path,
                    help="g2: instead of a page, turn the page's exported verdicts into G2's verdicts file at --out")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--sampled-only", action="store_true",
                    help="(legacy) render only the drawn sample. Reading one item validates its "
                         "family, so the sample IS the review surface; the full bundle stays in the repo.")
    args = ap.parse_args(argv)
    queue = json.loads(args.queue.read_text()) if args.queue and args.queue.exists() else None

    if args.gate:
        import book_config
        here = Path(__file__).resolve().parent
        if args.gate in ("g1", "g2"):
            if not args.book:
                ap.error("--gate g1/g2 needs --book")
            book = book_config.load_book(args.book)
            mp = args.manifest or (book.repo_path(book.manifest) if book.manifest else None)
            manifest = json.loads(mp.read_text())
            chapters = set(args.chapter) if args.chapter else None
            if args.gate == "g1":
                out = dossier_g1(book, manifest, args.objectives or here / "objectives" / book.book,
                                 chapters)
            else:
                rec = json.loads(args.recommend.read_text()) if args.recommend else None
                if args.export:
                    doc, todo = g2_file(json.loads(args.export.read_text()), rec)
                    args.out.parent.mkdir(parents=True, exist_ok=True)
                    args.out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
                    print(f"wrote {args.out}: G2 by {doc['by']}, {len(doc['items'])} verdict(s)"
                          + "".join(f"\n  TODO {t}" for t in todo))
                    return 1 if todo else 0
                out = dossier_g2(book, manifest, args.runs or here / "runs" / book.book / "lesson",
                                 chapters, args.sample, args.seed, rec)
        elif args.gate == "g3-mappings":
            if not args.mappings:
                ap.error("--gate g3-mappings needs --mappings (generate_widget_questions.py --pending-review)")
            out = dossier_g3_mappings(json.loads(args.mappings.read_text()), args.mappings.name)
        elif args.gate == "g3":
            bundles = [json.loads(p.read_text()) | {"bundle": p.name} for p in args.bundles]
            if not bundles:
                ap.error("--gate g3 needs --bundles")
            cat = json.loads(args.catalogue.read_text()) if args.catalogue else None
            flags = json.loads(args.flags.read_text()).get("flags", {}) if args.flags else None
            out = dossier_g3(bundles, cat, args.sample, args.seed, queue, flags)
        else:
            if not args.catalogue:
                ap.error("--gate g4 needs --catalogue")
            out = dossier_g4(json.loads(args.catalogue.read_text()),
                             [json.loads(p.read_text()) for p in args.s5], args.sample, args.seed)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(out)
        print(f"wrote {args.out} ({args.gate.upper()} dossier, {len(out) // 1024} KB)")
        return 0

    if not args.bundle:
        ap.error("pass a bundle (legacy G3 page) or --gate")
    bundle = json.loads(args.bundle.read_text())
    if args.sampled_only:
        if not queue:
            print("ERROR: --sampled-only needs --queue", file=sys.stderr)
            return 2
        picked = set(queue["question_ids"])
        bundle = dict(bundle, questions=[q for q in bundle["questions"] if q["id"] in picked])
    try:
        out = build(bundle, queue)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    args.out.write_text(out)
    print(f"wrote {args.out} — {len(bundle['questions'])} questions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
