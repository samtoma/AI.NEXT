# Feature spec 004 — Ask Noor: homework questions from the home page

**Status**: Prototype (`proto/homework-ask`). **Blocked on [ADR-0025](../../docs/decisions/0025-homework-ask-free-solve.md)**
(Proposed — Samuel), which this feature's tutor behaviour depends on.
**Source**: design handoff `design_handoff_home_ask` (README, `home-ask-design.html`, `wireframe.html`),
Tamer, 2026-10-13. Where the README and the design disagree, the design wins.
**Scope decisions (Tamer, 2026-10-13)**: ask flow + home; "Ask your teacher" is a visible slot that
sends nothing; no mastery credit from homework this round; the header nav keeps its FR-3219 labels
(the handoff's Learn / Skills / Exam / Me renaming is a separate requirement change).

## User stories

1. **Ask a typed question.** From the home page a student types a maths question and sends it.
   Noor reads it back, names the unit it matched, and offers "Walk me through it" or "Check my work".
2. **Upload homework.** The student attaches a photo or PDF (JPEG, PNG, PDF; 10 MB — the existing
   upload limits). Noor transcribes it and splits it into its separate questions.
3. **Several questions.** When a file or a typed message holds more than one question, Noor lists
   them and asks which one the student wants to start with. The student works one at a time.
4. **Finish a question, then choose.** When a walkthrough ends, the student can pick another
   question from the same homework or end the chat.
5. **Disagree.** "That doesn't look right" makes Noor re-check its own working and say plainly if it
   was wrong. Every press is logged for review.

## Functional requirements

| ID | Requirement |
|---|---|
| FR-3601 | The student home shows an **ask card** ("Got a question? Ask Noor") as the first block under the heading, above Up next, with an attach control, a text input and Send. The guardrail line reads exactly: "I won't give you the answer directly. I'll walk you through it step by step, so you can solve it yourself." No camera control. |
| FR-3602 | **One amber.** With the ask input empty and nothing attached, the recommended Up next row is the only amber control and Send is inactive. Once there is text or a file, Send is amber and no Up next row is. |
| FR-3603 | Sending creates a **homework ask** (typed text or an upload) and opens `/student/ask/{id}`. Asks, their questions and their flags are the student's own rows under row-level security and are tagged by environment (Principle XI). |
| FR-3604 | The ask's text — the typed message, or the upload's transcription once parsed — is **split into its questions** by a structured model call. Each question keeps its own label as written (e.g. "Q7"), its text, and its subject (`maths` or `other`). Metered on its own surface kind, `homework_split`. |
| FR-3605 | Each maths question is **matched to at most one learning objective** the student can see (the course gate applies). The match is shown as the unit line. An id the model returns that is not in the visible list is dropped, never shown. |
| FR-3606 | **Unreadable parts are never guessed.** An unreadable span is stored as a gap and shown as `▒▒` with a short prompt ("What is that number?") and an input. Both walkthrough choices stay disabled until every gap is filled. |
| FR-3607 | **Read-back.** Screen 2 shows "Your question", the "What I read" card (the question in a honey block, an "Edit the text" link), the unit line, the provenance line "Noor worked this out itself, so double-check the answer." and the privacy line "Only the question is kept from your file." (upload only). Editing the text updates what Noor teaches from. |
| FR-3608 | **Several questions.** With more than one question, Noor's first message says how many it found and asks which one to start with; each question is a selectable row. Only one question is active at a time. |
| FR-3609 | **Two modes.** "Walk me through it · step by step" (amber) and "Check my work · I'll show you my try" (white). Choosing one starts the chat for that question, below the choices, in the same column. |
| FR-3610 | **Homework tutor rules** (ADR-0025): Noor never says "The answer is" and never gives the final answer before the student has worked it; it leads one step at a time; it uses the matched objective's methods where one fits; and every walkthrough ends with "Put your answer back into the question." with the check worked in numbers. |
| FR-3611 | When the student completes that final check, Noor emits `{{question_done}}`; the question is marked done and the page offers **"Pick another question"** (when any remain) and **"I'm done for now"**. The student can also pick another question at any time. |
| FR-3612 | **Disagree links.** Under Noor's latest message: "That doesn't look right" and "Ask your teacher". The first sends a re-check turn and writes a `homework_flags` row; the second shows a pre-filled note card whose Send is disabled in this round ("Teacher notes are coming soon"). |
| FR-3613 | **Not maths.** A question classified `other` is shown with "I only cover Maths so far" and offers no walkthrough. |
| FR-3614 | Homework turns run on the `/api/ask` route as surface `homework` and session kind `homework`, logged to `ai_interactions` like every other turn (ADR-0023: no turn cap). No mastery is written from this surface. |

## Out of scope this round

Camera capture · teacher records and sending notes · mastery credit · matching to a reviewed bank
solution ("Checked against the textbook") · the Learn / Skills / Exam / Me header ·
resuming a homework chat transcript after a reload (the questions and their done state persist;
the conversation does not).

## Acceptance (from the handoff §10, as applicable)

1. The ask card is the first block under the heading, above Up next.
2. One-amber rule holds before and after typing.
3. Screen 2 is one centred column with the chat below the choices.
4. Editing the question text updates "What I read".
5. "That doesn't look right" leads to a re-check and writes a flag; "Ask your teacher" opens a pre-filled note.
6. Every walkthrough ends with "Put your answer back into the question."
7. The attach button is a paperclip with a tooltip and an accessible label.
8. Works from 1024px down to 360px wide.
