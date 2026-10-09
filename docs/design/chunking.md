# Noor — Chunked tutor turns

Rules for how the tutor's generated messages are shaped and shown. Requirements **FR-3501…FR-3508**
in [spec 002](../../specs/002-identity-and-admin-console/spec.md) are what the code is held to; this
document is the reasoning and the house style behind them.

**Why:** student feedback (GitHub issue #23 and the Prototype 1.1 review). Three failures, all from
the same cause — a reply arrives as one block of text:

1. Students miss the question at the end because it sits under a lot of text.
2. One reply covers two topics back to back.
3. A figure and a question arrive in the same reply, and the question is read before the figure is
   looked at.

**Who for:** Egyptian Prep-3 students, many reading maths in English as a second language, often
tired, often anxious about looking slow. Every rule lowers reading load without lowering the maths.

**How the rules are written:** each one is checkable in code or in review. A rule that can't be
checked isn't here.

---

## 1. The experience

### The student taps through a long reply, beat by beat

The tutor already writes in **beats** — short parts separated by a `{{beat}}` marker on its own line.
Until now a beat was only a timed pause; the whole reply then sat in one bubble.

Now a long reply **pauses after each beat**:

- Only the first beat appears. The chip row above the typing box swaps to two chips:
  **Say it another way** and an amber **Continue ↓**. The bubble itself gains nothing.
- **Continue** shows the next beat. Earlier beats stay visible.
- **Say it another way** ends the reply where the student stopped reading — the unread beats are
  dropped from the screen and from what the tutor sees next — and sends "Say it another way" — the same words as the lesson's default chip, so the two never disagree.
- The question appears only once every beat before it has been shown, so it is always the last thing
  on screen and is never above text the student hasn't reached.
- No model call is involved. It costs nothing and adds no waiting.

Why the chip row (option D, Tamer, 2026-10-09): it is where the student's thumb already is, it keeps
the bubble clean, and the two moves a stuck reader actually has sit side by side.

**When a reply pauses** (FR-3501):

| Reply | Pauses for Continue? |
|---|---|
| One beat (e.g. "Exactly." + a question) | No — shown at once |
| Several beats, fewer than **40 words** of prose in total | No — timed pauses, as today |
| Several beats, **40 words or more** | Yes, at every beat |
| A beat holding a **figure**, with more after it | **Always**, whatever the length |

The 40-word line exists because teenagers asked to tap after every sentence feel patronised. The
button is for real reading load, not for ceremony.

While a reply is paused, the typing box stays disabled, as it already is while a reply is arriving.
The two chips are the things to do.

### The question looks different — inside the same bubble

The question is **not** a separate message box. It is a tinted block at the foot of the tutor's
bubble (FR-3502):

- **Honey fill with its paired ink** (`bg-card-warm` / `text-ink` — Noor Play tokens, never a literal
  colour), no border of its own: a fill inside the bubble, never a box inside a box.
- The part the student must answer is in **bold**.
- 16px of space separates it from the explanation above.

Why not a separate bubble: in a chat, a new bubble means a new message. A second bubble would read as
the tutor saying something else, would split one reply into two for read-aloud and for the console's
replay, and would make the question look detached from the explanation it belongs to. The tinted
block gets the visual separation without that cost. Question cards and widgets are already their own
cards and stay as they are.

### One topic per reply

A reply teaches **one learning objective** (FR-3504). When the tutor finishes one objective, that
reply ends with its question as usual; the next objective starts in a later reply, after the student
has answered.

There is **no "Still with me?" card** between topics. The question that ends every reply is already
the check — a second check on top of it would only slow the lesson.

The one-line reaction to the student's last answer ("Exactly.") carries no citation, so a reply that
reacts to objective A and then teaches objective B is still caught: its citations name two
objectives.

### A figure gets its own step

A figure is a beat of its own. If a question follows it, the reply always pauses for **Continue**
between them (FR-3505), so the student has looked at the figure before reading what to do with it. The figure
stays on screen while they answer.

---

## 2. The shape of every reply

```
feedback   — one short line, its own beat              "Close, but not quite."
explain    — 1–3 beats, one idea each                  "A function is a **special kind** of relation."
ask        — {{ask}} then the question, always last    "**Which pairs follow the rule?**"
```

The protocol stays text with markers — it streams, it carries inline citations, and read-aloud
depends on it. Two markers do the structural work:

- `{{beat}}` — alone on its own line, between beats. Unchanged.
- `{{ask}}` — **new.** Alone on its own line, immediately before the open question that ends the
  reply. Everything after it is the question and is rendered in the tinted block.

An ask that is a **question card** (`{{show_question:…}}`) or a **widget** needs no `{{ask}}` — the
card is the ask. Either way there is **at most one ask per reply, and it is last** (FR-3503). Replies
that should not quiz — the Your Progress chat, the closing message of a lesson — carry none.

If the model forgets `{{ask}}`, a finished reply whose last paragraph is a question (ends in `?` or
`؟`) after more than one beat is shown in the tinted block anyway, and the miss is logged.

## 3. Limits (the numbers)

| Thing | Limit |
|---|---|
| Sentence length | ≤ 20 words |
| Beat | 1–2 sentences, ≤ 25 words, **one idea** |
| Beats per reply | ≤ 4, counting the ask |
| Asks per reply | ≤ 1, always last |
| Questions per ask | exactly 1 — the follow-up ("Why?") waits for the next reply |
| Learning objectives cited per reply (lessons) | ≤ 1 |
| Figures per reply | ≤ 1, in a beat of its own |
| Bold phrases | ≤ 1 per beat |
| Dashes (—) | ≤ 1 per sentence |
| New terms introduced per reply | 1 |
| Items in a list shown at once | 3–4 while learning something new |

## 4. Writing rules for the tutor

1. **Same shape every reply:** feedback → explain → one ask. Predictable structure frees attention
   for the maths.
2. **Feedback is short and comes first.** "Exactly." / "Close, but not quite." One sentence, its own
   beat, no citation.
3. **One idea per beat.** If a beat needs "and also", it's two beats.
3a. **One question per ask.** "Could you still draw X × Y as a grid of dots? Why or why not?" is two
   questions. Ask "Could you still draw X × Y as a grid of dots?"; when the student answers, "Why?"
   is the next reply's ask.
4. **Plain, literal English (CEFR B1).** No idioms or wordplay: not "close cousin", "make the cut",
   "nice catch", "piece of cake". Warmth comes from short, kind sentences. This replaces the old
   "upbeat, playful" tone line in the lesson prompt.
5. **Emphasis is bold, never ALL CAPS.** "a SUBSET" → "a **subset**". Caps read as shouting and are
   slower to read. Acronyms stay as they are.
6. **No italics.** They are harder to read for dyslexic students.
7. **Words before symbols.** The first time a symbol appears in a session, say it in words:
   "$a \in X$ (a is in X)". After that, the symbol alone is fine.
8. **Show, don't list in prose.** Three or more parallel items (pairs, steps, cases) go in a list,
   never in a sentence.
9. **One new term per reply.** Bold it on first use and give its meaning in the same beat.

## 5. Maths

1. **Never break an expression across lines.** Inline math doesn't wrap; if it doesn't fit, it
   becomes display math on its own line.
2. **Lay out sets and pairs in rows of 3–4**, not in a sentence.
3. **Space after commas** in sets and pairs: `{1, 2}`, `(a, b)`.
4. **Equations are always LTR**, in any direction of text.

## 6. What is checked automatically

Every finished tutor reply is checked on the server after it is delivered (FR-3507). A breach is
**logged, never regenerated** — by the time it could be checked the student has started reading it.
Each breach is one `chunking_violation` analytics event carrying the rule names and counts, never the
message text, tagged by environment.

| Rule id | Fires when |
|---|---|
| `sentence_too_long` | a sentence has more than 20 words |
| `beat_too_long` | a beat's prose has more than 25 words |
| `too_many_beats` | more than 4 beats |
| `multiple_asks` | more than one ask (`{{ask}}`, question card, interactive widget) |
| `ask_not_last` | anything but whitespace follows the ask |
| `missing_ask_marker` | the reply ends in a question with no `{{ask}}` |
| `multiple_objectives` | a lesson reply cites more than one learning objective |
| `figure_and_ask_same_beat` | a beat holds a figure and the ask together |
| `figure_not_alone` | a beat holds a figure and prose together |
| `compound_question` | an ask holds more than one question mark, or "why or why not" |
| `all_caps` | a word of 3+ letters in capitals that isn't a known acronym |
| `dash_overuse` | a sentence with more than one — |
| `italics` | single-asterisk emphasis |
| `idiom` | a phrase from the idiom list |

Each **Continue** is recorded as a `button_click` (`name: "chunk_next"`), and each **Say it another
way** at a pause as `chunk_another` (FR-3508), so the effect can be measured: how many beats students
read through, and where they stop.

## 7. Worked example: before → after

From the live lesson screen (Lesson 1-2, Relations).

**Before:** one bubble, three ideas, two idioms, ALL CAPS, three dashes, an inline citation and the
question buried at the end.

> Ooh, close cousin but not quite — a function is actually a special, extra-strict TYPE of relation,
> not the whole picture. Think of it this way: a relation from X to Y is just any set of ordered pairs
> (a, b) with a ∈ X and b ∈ Y — really, any subset of X × Y at all. [Relations between sets] So here's
> my real question: with X = {1, 2} and Y = {2, 4, 6}, what does X × Y even look like — can you list
> a few pairs in it?

**After — what the model writes:**

```
Close, but not quite.
{{beat}}
A function is a **special kind** of relation. [[lo:u1-1-2]]
{{beat}}
A **relation** from X to Y is any set of pairs (a, b). Here a is in X and b is in Y.
{{beat}}
{{ask}}
X = {1, 2} and Y = {2, 4, 6}.
**Can you list a few pairs in X × Y?**
```

**What the student sees:** "Close, but not quite." → **Continue** → the function sentence →
**Continue** → the relation sentence → **Continue** → the honey question block.

## 8. Out of scope here

These were in the first draft and belong elsewhere:

- **Static UI copy, button wording, contrast checks across the app** — design-system rules, to be
  proposed to Noor Play rather than built on this branch.
- **"Show me an example"** — examples must come from stored canonical solutions or the library
  (grounded teaching), so this needs its own requirement.
- **Voice answers** — a PRD non-goal.
- **A tap-for-meaning glossary, session length in minutes, a "Step 1 of 2" counter** — separate
  features.
