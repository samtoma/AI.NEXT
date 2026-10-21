# Superseded verify runs

- `s7b-verify.20261021T083920Z` (prompt s7b-v3) — the blind verifier was not told a question's own board
  (`grid`), so it judged the half-step point C(−3, −3/2) unreachable on a whole-number board, and it was not told
  that relation mode adds the answer's reversed pairs as decoys, so it refused `reversed-pairs`. Both are defects of
  the prompt, fixed in s7b-v4 (`_board_text`, the relation instrument text), and the unit was re-verified the same
  day (`s7b-verify.20261021T084017Z`). Kept here for the record; `finish` does not read this folder.
