# Build reviews

Self-contained HTML pages written to be **presented**, not read as source. Each one is a snapshot
of the build at a named date — open the file in a browser, or read the artifact link below.

They are committed here because the numbers in them are claims about this repository, and a claim
about the repository should live next to the thing it describes. Nothing else depends on them: no
build step reads this directory.

| Date | Review | Published |
|---|---|---|
| 2026-09-10 | [Two Environments, One Book](./2026-09-10-two-environments-one-book.html) — Student MVP 1.0 build review: what is done, what proves it, and the four decisions blocking a pilot | [artifact](https://claude.ai/code/artifact/ce3ee819-00b3-474b-b630-c73f6a7537ac) |

## Conventions

- Filename is `YYYY-MM-DD-slug.html`, dated by the state it reports rather than the day it was
  edited.
- **A review is never edited after the fact.** It is a record of what was believed on that date; a
  later correction is a later review. The living status document is
  [`docs/PROJECT_STATE.md`](../PROJECT_STATE.md), and the row-by-row requirement map is
  [`specs/001-student-mvp1-delta/traceability.md`](../../specs/001-student-mvp1-delta/traceability.md)
  — those two are the ones that get updated.
- Self-contained: no build step, no local assets. The only external requests are the Google Fonts
  stylesheet and its font files, so the page degrades to its fallback stacks offline rather than
  breaking.
- Palette and type come from the Nour design system, so a review of a design decision is rendered
  in the language it is deciding about.
