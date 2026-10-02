"""RETIRED 2026-09-25 (decision 22, B19, FR-4409): this is no longer a source of the catalogue.

    uv run build_misconceptions.py ...     # refuses, and says where to go instead

It used to hold the Prep-3 maths misconception catalogue as `mc(...)` calls and
write `seed/misconceptions-math.json`, a file nothing loaded. The product loads
`seed/generated/misconceptions.json`, and the two had drifted: six `t2u3-1-2`
entries lived only here, and four entries lived only in the loaded file. Two
sources for one catalogue is how that happens, so there is now one.

WHERE THINGS WENT
  * The catalogue: `seed/generated/misconceptions.json` is the single source.
    Edit it there. The six `t2u3-1-2` entries and their seven book-distractor
    maps moved into it, and so did the `kind` and `aliases` the database export
    had dropped. Never rename a live id; a duplicate becomes an alias (FR-1115).
  * The house style for a refutation, which was this file's `mc()` docstring
    (step 1 names what the student was thinking without calling it stupid; the
    last step leaves them with the move that works; argue against THAT error
    with the book's own method): `runbook/misconceptions.workflow.js`
    (HOUSE_STYLE), and `docs/specs/extraction-pipeline.md` §3.8.
  * Authoring a catalogue for a new book: the S5 stage,
    `runbook/misconceptions.workflow.js` + `assemble_misconceptions.py`.
  * The last generating version, for history:
    `git show v0.9.2:services/extraction/build_misconceptions.py`.

`tests/test_misconception_catalogue.py` holds the single source to this: every
id the v0.9.2 catalogue had is still there and served unchanged, the six
entries are in with their refutations and maps, no alias was lost, and every
distractor stamp resolves.
"""

from __future__ import annotations

import sys


def main() -> int:
    print(
        "REFUSING: build_misconceptions.py is RETIRED (decision 22, B19). The maths misconception\n"
        "catalogue has one source: services/extraction/seed/generated/misconceptions.json. Edit it\n"
        "there. A new book's catalogue comes from the S5 stage (runbook/misconceptions.workflow.js,\n"
        "then assemble_misconceptions.py).",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
