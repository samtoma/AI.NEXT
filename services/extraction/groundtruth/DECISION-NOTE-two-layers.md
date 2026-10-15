# Decision note for Samuel: book record and teaching layer

**Status:** proposed by Tamer, 2026-10-15. Awaiting Samuel. Not an ADR until he confirms it.

## The proposal

Split lesson content into two layers.

1. **Book record**: only what the textbook prints, one record per printed thing, each with a page and
   a quote. It is used both as hand-checked ground truth and as the shape extraction produces, so
   extraction can be scored record by record. Format:
   [book-record.schema.json](book-record.schema.json) (v2), rules in [README.md](README.md).
2. **Teaching layer**: everything that is not printed — answers to exercises the book leaves
   unanswered, generated questions and variants, wrong answers, misconceptions, prerequisites,
   visuals. Each teaching record points at a book-record id, says where it came from
   (`generated` or `teacher`) and carries its own review. Its schema is not written yet; it will be
   defined when the teaching layer is built.

## Why

- **Scoring stays honest.** If generated answers sat beside printed ones, an extractor would be
  marked down for not "finding" answers the book never printed.
- **"Generated" is a property of where a record lives**, set by the generator when it writes, not a
  label someone must remember to add. A reviewed generated answer stays generated.
- **The book's mistakes are handled once.** Misprints are recorded in the book record with the
  printed and intended reading; the scorer accepts either, the teaching layer uses the intended one.

## What it costs

- Today's content (questions, objectives, misconceptions, visuals) has no link to book items. When
  the book is re-ingested in this format, today's records are either attached to book ids or
  regenerated.
- Objectives will be redrawn from the re-ingest (lesson 1-1: 4 today, 5 in the ground truth). Student
  mastery and attempts are keyed on today's ids (`lo:u1-1-1`, `q:u1-1-1:001`). **Open:** do live
  students' progress records need carrying over (a migration at re-ingest time), or do students
  start fresh?

## Decided so far (Tamer, 2026-10-15)

Within the book record: parts stay flat; new `table` and `heading` types; `belongs_to` and
`answer_figure` links; a structured `misprints` field; objectives take their pages from their
evidence; ground truth must quote; a lesson-wide id scheme frozen once reviewed; written counting
rules. All of these are in the schema and README; both ground-truth files follow them.

## What Samuel is asked

1. Confirm (or reject) the two-layer split as the architecture for lesson content.
2. Decide whether students' existing progress must survive the re-ingest.
