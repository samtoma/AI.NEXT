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
      "notes": "for the reviewer"
    }

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
