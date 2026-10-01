"""Declarative question families (decision 16, FR-4304; pipeline spec §3.9, build item B12).

A FAMILY is data, not code. A spec file under ``families/<book>/`` says what a
family samples, how its stem reads, how its answer and its worked solution are
computed from the sampled numbers, and which misconception each wrong option
names. ``generate_questions.py --families families/<book>`` instantiates it with
the same driver, the same ``verify()``, the same duplicate-stem rejection and
the same ``rebalance_keys()`` as the 35 hand-written Python families. Nothing a
model writes is ever executed: every expression in a spec is parsed into a
syntax tree and walked by :mod:`families.evaluator`, which knows a fixed list of
operations and nothing else (no attribute access, no imports, no names it was
not given, bounded work).

THE FORMAT (``"format": "ainext.family/1"``), one family per file::

    {
      "format": "ainext.family/1",
      "id": "tpl:g10m4s2-1-1:balance",       # family id; the item ids end in its last part
      "kind": "family",                        # or "authored": a one-off with no params
      "lo_id": "lo:g10m4s2-1-1",               # exactly one objective
      "parent_question_id": "q:g10m4s2-1-1:ex4-1-3a",   # the book question it derives from
      "parent_kind": "question",               # optional: "question" (default) | "teaching" — see below
      "source_page": 57,
      "tier": "basic",                         # basic | standard | advanced
      "answer_type": "numeric",                # numeric | mcq | expression
      "context": null,                         # word problems: the fixed context, in words
      "params": [                              # sampled IN ORDER from the family's own stream
        {"name": "x", "randint": [-6, 8]},
        {"name": "a", "choice": [2, 3, 5], "resample_while": "a == x"},
        {"name": "vals", "sample": {"from": "range(3, 60)", "k": 6}},
        {"name": "c", "let": "a * x + 4"},
        {"require": "c != 0"}                  # false -> this attempt is rejected
      ],
      "constraints": ["gcd(a, c) == 1"],       # checked after params, before choices
      "stem": "Solve ${=linear(a, 4)} = {=c}$.",
      "answer": "x",                           # numeric: an int, or a string you formatted
      "solution": ["Subtract $4$: ${=a}x = {=c - 4}$.", "..."],
      "choices": {                             # answer_type "mcq" only
        "correct": "${=x}$",
        "distractors": [
          {"text": "${=-x}$", "misconception_id": "mc:g10m4s2-1-1:sign-lost-transposing"},
          {"text": "${=x + 1}$", "misconception_id": null}
        ]
      },
      "marker": {                              # answer_type "expression" only (FR-4320)
        "kind": "expression",                  # expression|equation|values|interval|coordinates|surd|recurring
        "answer": "(x + {=p})*(x - {=q})",     # PLAIN maths; the LaTeX key is rendered from it
        "form": "factorised",                  # null|factorised|expanded|simplest|{"subject": "x"}
        "variables": ["x"],
        "tolerance": null
      },
      "proposed_misconceptions": [],           # ids this spec uses that S5 has not written yet
      "distinct_by_choices": false,            # optional, mcq only — see DUPLICATES
      "notes": "for the reviewer"
    }

DUPLICATES. Two instances with the same stem are one question, and the second is dropped. For a multiple-choice
family whose stem is the same sentence in every instance ("Exactly one of the following numbers is irrational.
Which one?") and whose options carry the variation, that would leave one item. ``"distinct_by_choices": true``
says the options tell instances apart: the filter then reads stem plus the SET of options (a reshuffle is not a
difference). It is off unless declared, so a family filtered on its stem keeps exactly the items, and the item
ids, it always had.

PARENT. A family derives from ONE book item of its objective: by default a book question
(``parent_question_id`` ``q:<lo tail>:<item>``). Where the book gave the objective no markable
question — its items are teaching material, drawings above all — the parent may instead be a book
TEACHING item (Samuel's answer 40, 2026-10-01): ``"parent_kind": "teaching"`` and the worked
example's library id, ``"parent_question_id": "expl:<lo tail>:<item>"``. The kind is declared,
never guessed from the id, and the check refuses an id that disagrees with it. Omitting
``parent_kind`` means ``"question"``, so every spec written before answer 40 is unchanged.

RECURRING DECIMALS. A marker of kind "recurring" is an exact rational, written either as plain maths (``7/9``,
``9 + 19/66``) or in the book's own notation: a dot over the first and last digit of the repeating block
(``0.8\\dot{3}``, ``9.2\\dot{8}\\dot{7}``) or a bar over it (``0.1\\overline{045}``). The evaluator reads the same
set the app's marker does (those two, ``0.(45)`` and ``0.4545...``) as the exact fraction they stand for, in the
marker's answer, in the key it prints and in a blind grader's answer. The key prints in the notation the
author wrote (a stem that asks for a bar keeps its bar); a plain fraction prints with dots. A stem that asks for
the number "in decimal form" sets ``"form": "decimal"``, or the app accepts a fraction for it (T413).

Templates (``stem``, ``solution[]``, choice texts, ``marker.answer``) interpolate
``{=expression}``. A number renders through the house ``num()`` (no trailing
``.0``, a Fraction as ``\\frac``, the minus outside the fraction), a string as
it is. Braces are LaTeX's; only ``{=`` opens an interpolation, so
``\\frac{{=b}}{2}`` means "the fraction with numerator b".

Why each rule exists is in :mod:`families.spec`, next to the check that
enforces it.
"""

FORMAT = "ainext.family/1"
WIDGET_FORMAT = "ainext.widget-template/1"
