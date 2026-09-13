# Handoff — local deployment

Paste the block below as the first message of a fresh Claude Code session opened
on your own machine, in your clone of this repository.

Everything it needs is committed. The local setup was rebuilt from an empty
database on 2026-09-13 and verified byte-identical to the database this work was
developed against — same 1041 live questions, same MD5 digest over every live
question id.

---

## The prompt

```
Read CLAUDE.md, then docs/PROJECT_STATE.md, then docs/LOCAL-DEV.md.

I want the Student MVP 1.0 comparison build running on this machine.

1. Sync first. I have been working on the branch
   claude/tamer-shared-drive-access-ddpypu — fetch and check it out, and tell me
   what changed since my local copy (git log --oneline). Do not merge anything
   into main.

2. Then bring the stack up:

       ./scripts/local-dev.sh

   It creates the database, applies the schema and all nine migrations, loads
   the book (450 questions), restores the generated bank (543), the widget
   questions (48) and the 96-entry misconception catalogue, creates a demo
   student, runs the content parity check, writes app/.env.local and serves on
   http://localhost:3000. It is idempotent — safe to re-run. --reset starts from
   an empty database.

   If it stops, read what it prints before changing anything: it names the exact
   command for my platform when it cannot reach Postgres, and it refuses rather
   than guesses when the database is in a state it did not expect.

3. Confirm it is actually working, and show me the evidence rather than
   asserting it:

   - PARITY: GREEN, and 1041 live questions (491 mcq, 502 numeric, 48 widget)
   - http://localhost:3000/dev/widget-questions   — the 48 stored constructions,
     read from the database at request time. Drag one wrongly and check that the
     answer comes back diagnosed, with the refutation written for that specific
     error, and that mastery moves.
   - http://localhost:3000/dev/math-widgets      — all 11 widgets plus the five
     payloads that must refuse to render
   - http://localhost:3000/admin/content        — provenance: every generated
     row unreviewed, every book row from the book
   - http://localhost:3000/student              — the student surface
   - cd app && npm test                          — 102 tests

4. Then stop and tell me what is and is not working. Do not start new feature
   work.

Context you need:
- Two environments, one book (ADR-0007). This is the COMPARISON build. The
  baseline on main is frozen and must not receive teaching-behaviour changes.
- Unreviewed generated content is bounded to the comparison environment. The
  loaders refuse unless AINEXT_ENVIRONMENT=mvp1. That is constitution III as
  amended by ADR-0008 — do not work around it.
- Lesson and chat turns need the `claude` CLI logged in and spend tokens on my
  account. Everything else — student creation, practice, grading, mastery,
  widgets, the dashboard — works without it. Do not spend AI turns unless I ask.
- The most recent work is ADR-0009: an interactive widget is a question. Read
  docs/decisions/0009-widgets-as-questions.md before touching the widget,
  attempt or misconception code.
```

---

## What to expect, so you can tell a real failure from a normal message

| Message | Meaning |
|---|---|
| `--all: skipped 2 non-bundle file(s)` | Correct. Those two are a stale catalogue and a social-studies fixture, neither of which is a maths bundle. |
| `NOTICE: constraint ... does not exist, skipping` | Correct. Every migration is idempotent and drops before it adds. |
| `2 cross-objective misconception reference(s) restored as-is` | Correct, and deliberately noisy. One generated question names a misconception filed on the next lesson's objective. It is a real content inconsistency to fix at the source; refusing to restore it would make the committed bundle unrestorable. |
| `2 misconception(s) carry no refutation and got no entry` | Correct. Two alias rows have no refutation of their own. Writing an empty one would serve a student a blank explanation. |
| `126 of them generated and unreviewed` | Correct and worth keeping in view: that is how much ungated mathematics is live. |
| `PARITY: GREEN` | The book constant matched exactly. This is the one that must never go red. |

## Known gaps — do not report these as bugs

- **No tutor turn has ever chosen a widget** (T119). The prompt documents them
  and the bank is loaded; whether a model reaches for the right one at a real
  teaching beat is unmeasured.
- **Widget questions cannot be reviewed yet** (T122). Twenty are queued;
  `render_review_page.py` renders multiple-choice and numeric only.
- **13 of 90 objectives carry a widget question** (T123).
- **Nothing has run on a real iPad** (T120), which is the device target.
- **Docker path unproven** (`scripts/local-docker.sh`). Written and
  schema-validated; never run end to end, because the container this was built
  in cannot reach Docker Hub. The native path above is the tested one.
- `app/.env.local` is written once and then left alone. If you point the app at
  a different database, edit `DATABASE_URL` by hand.

## If you want the whole thing from scratch

```bash
./scripts/local-dev.sh --reset
```

Drops the database and rebuilds it. Takes about a minute and ends at the same
1041 questions.
