"""Render a generated question bundle as a human review page.

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
from pathlib import Path

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
}
BLACKBOARD = {"Z": "\u2124", "R": "\u211d", "N": "\u2115", "Q": "\u211a"}
SUPERSCRIPT = {"0": "\u2070", "1": "\u00b9", "2": "\u00b2", "3": "\u00b3",
               "4": "\u2074", "5": "\u2075", "6": "\u2076", "7": "\u2077",
               "8": "\u2078", "9": "\u2079", "n": "\u207f"}


def to_unicode(tex: str) -> str:
    out = re.sub(r"\\mathbb\{([A-Z])\}", lambda m: BLACKBOARD.get(m.group(1), m.group(1)), tex)
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("bundle", type=Path)
    ap.add_argument("--queue", type=Path, help="the *.review-queue.json written at load time")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    bundle = json.loads(args.bundle.read_text())
    queue = json.loads(args.queue.read_text()) if args.queue and args.queue.exists() else None
    try:
        page = build(bundle, queue)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    args.out.write_text(page)
    print(f"wrote {args.out} — {len(bundle['questions'])} questions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
