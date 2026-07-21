# Proposal: The Multi-Subject Spine — separated by default, bridged by exception

- **Status:** Proposal — awaiting Samuel's decisions (§7)
- **Date:** 2026-07-21
- **Trigger:** Samuel: subjects must be split; what happens when a student asks a history question mid-math; per-subject ratings; the graph must know they're different — *but hint at genuine cross-subject relations* ("that would be revolutionary").

## 1. The gap today (measured, not assumed)

| Layer | State today |
|---|---|
| **Data model** | ✅ Already separated. Course nodes (`course:prep3-math-en`, `course:prep3-social-ar`); every LO → module → course. 90 math LOs, 10 social LOs. **Zero cross-course edges.** |
| **Evidence Walk graph** | ❌ Draws *all* LOs in one undivided space — math and social would interleave. |
| **Chat grounding (`ask.ts`)** | ❌ `spine_chat` ships every LO/edge; a chat can blend subjects. (Per-course source-doc fix already in flight is step one.) |
| **Ratings / report cards** | ◐ Mastery is per-LO (so per-subject is derivable) but nothing rolls it up *by subject* yet. |
| **Lesson picker** | ◐ Groups by module but lists all courses together. |

**The principle that resolves all of it:** *Subject is a first-class dimension. Separated by default, bridged by exception.* The data already encodes subject; make every surface and the grounding subject-aware, and add ONE new thing — a curated cross-subject relation — for the "revolutionary" part.

## 2. The knowledge graph — territories, not a blend

- **A subject selector** on the Evidence Walk: `All · Mathematics · الدراسات الاجتماعية`. Default view can be one subject at a time; "All" shows both.
- **Each subject is its own visual territory** — spatially clustered, its own accent world (math stays ink/viridian; social gets a distinct sepia/ochre world), a labelled boundary. They never interleave node-by-node.
- **Bridges are rare and special:** the few cross-subject relations (§5) render as **dashed gold arcs** spanning the gap between territories — visually distinct from the solid prerequisite edges, so they read as *"a discovered connection,"* not clutter. Hover → the one-line rationale.
- This is the literal answer to *"the graph can fully understand they are really different, but keep a nice hint if there is a relation."*

## 3. The cross-subject chat question (Samuel's core question)

**Scenario:** the student is mid-math-exercise and asks a history question.

**Options weighed:** (a) hard-pause + "switch subjects?" modal; (b) fully seamless inline answer; (c) hybrid.

**Recommendation: (c) — seamless *awareness* + offered *handoff*. Never a hard pause; never a blind inline answer.** The reasoning is not just UX, it's the thesis:

- A lesson session is **grounded in ONE subject's slice** of the spine. The math session's grounding does **not** contain the history canonical facts.
- So answering the history question *inline* would force the model to **solve from memory** — precisely the hallucination the whole product forbids. Seamless cross-answering would quietly break groundedness (and history is where LLMs confabulate most confidently).
- A hard modal, on the other hand, treats a curious student like they made an error.

So the tutor:
1. **Recognizes** the question is outside the current subject (the grounding already declares what's in scope; extend the existing "outside the ingested slice" rule to "outside THIS subject").
2. Gives a brief, warm acknowledgment — not a mini-lesson.
3. Offers a **one-tap handoff chip**: «ده سؤال دراسات — تحب نكمل الرياضيات ونرجعله بعدين، ولا نفتح درس الدراسات؟» The math session is preserved and resumable (we already built session persistence).

**The magic exception — where it *does* answer across:** if the question lands on a **bridged** topic (a curated `relates_to` edge exists, §5), the tutor may *name the connection* because it's grounded: *"good instinct — that's the same coordinates idea you used in math."* That is grounded cross-awareness, not confabulation — and it's the moment that feels revolutionary.

Net: subjects stay separate and safe; curiosity is honored with a clean switch; genuine connections light up exactly where they're real.

## 4. Per-subject ratings — rolled up, never blended

- Mastery is per-LO and every LO has a subject → **per-subject mastery is a free aggregate.** No schema change.
- Report cards, streaks, and any overview roll up **per subject**. **Never a single blended number** — "62% across math and history" is meaningless and misleads parents.
- **Student home = subject cards**, each with its own mastery, weakest topic, streak, and "today's plan." `understanding_checks` and `ai_interactions` get a derived `subject` for per-subject analytics and the (future) per-subject WhatsApp parent report.

## 5. The bridges — the revolutionary part (grounded, curated, rare)

A **new edge type `relates_to`** (cross-course, associative): **NOT a prerequisite** — it never gates a lesson, never touches the DAG or mastery. It carries a **`rationale`** (one line) and, per our provenance discipline, an assertion of *why* it's a real connection (human- or agent-proposed, human-approved).

**Genuine bridges in THIS curriculum (not contrived — these are the transfer points a great teacher names):**

| Math | ↔ | Social Studies | The shared idea |
|---|---|---|---|
| Coordinate plane / ordered pairs (`lo:u1-1-4`, u5) | | Map grid · خطوط الطول والعرض | an ordered pair locates a point |
| Ratio & proportion (u2) | | Map scale · مقياس الرسم | scale *is* a ratio |
| Statistics: mean & dispersion (u3) | | Reading population/climate/economic tables & bar charts | data literacy |
| Number line / negative numbers | | Chronology · قبل/بعد الميلاد on a timeline | signed positions on a line |

Surfaced at two moments, always gentle, never forced:
- **On the graph:** the gold bridges (§2).
- **In a lesson:** when the tutor reaches a bridged concept, a soft inline hint — «🔗 صلة بمادة تانية: شفت الفكرة دي في الرياضيات» — that the student can tap to see the connection, or ignore.

**Why it matters commercially:** fragmented tutoring (a math tutor here, a history tutor there) *never* connects subjects. A spine can. Pitch line: *"AI.Next doesn't just teach subjects — it teaches how they connect, the way one great teacher would."* This is the clearest payoff yet of "build a spine, sell verticals": the verticals aren't just cheaper to build — together they're worth more than apart.

## 6. Everywhere else, subject-aware
- **Lesson picker:** subject headers, subject-first (RTL for social).
- **Grounding:** a lesson session grounds ONLY in its subject's LO/question/visual slice (extends the in-flight per-course source-doc fix). `spine_chat` (the observer/investor view) may span all, but every node is labelled with its subject.
- **Cost meters / evals:** tagged by subject.

## 7. Decisions for Samuel

1. **Chat cross-subject behavior:** confirm **seamless awareness + offered handoff** (recommended) vs hard-pause vs blind-seamless. *(Recommend: awareness + handoff — it's the only one that keeps grounding honest.)*
2. **Bridges now?** Build the `relates_to` edge type + seed ~4 curated math↔social bridges in this wave? *(Recommend: yes — it's the revolutionary bit, it's small, and it's the demo's "wow.")*
3. **Score model:** per-subject only, never blended? *(Recommend: yes.)*
4. **Student home:** build the per-subject overview ("home") screen now, or after? *(Recommend: a light version now — it's where separation becomes visible and it frames the demo.)*

## 8. Build plan — "Wave 1.5: Multi-Subject Spine" (before the two-subject demo)

Mostly presentation + grounding-scoping; the data model is ready. (a) `relates_to` edge type + validators + ~4 curated, reviewed bridges; (b) Evidence Walk territories + subject filter + gold bridges; (c) subject-scoped lesson grounding + the out-of-subject recognition/handoff rule + the bridge-aware hint; (d) per-subject report roll-up + a light subject-home; (e) subject tags on the logs. Wave 1's lesson wiring (widgets, RTL, per-course source doc) is the foundation this sits on — it lands first.
