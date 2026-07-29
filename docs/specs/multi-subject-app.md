# Study & Plan — Arabic as a first-class subject + demo student switching

**Status:** study complete, plan awaiting Samuel's approval. Nothing implemented yet.
**Trigger:** Arabic is a third subject, and the app cannot represent one.

---

## Part 1 — The study: why Arabic can't just be "added"

### 1.1 The core finding: the fallbacks are binary, so Arabic becomes *maths*

This is not a missing feature; it is a **silent misclassification**. Two functions decide a
subject for the entire product, and both are two-valued with maths as the default:

```ts
// app/src/lib/lesson.ts:66
export function subjectOfCourse(courseId) {
  return courseId?.endsWith("-social-ar") ? "social-ar" : "math-en";   // ← Arabic ⇒ math-en
}
// app/src/lib/subject-queries.ts:27
if (courseId) return courseId.endsWith("-social-ar") ? "social" : "math";  // ← Arabic ⇒ math
```

Load `course:prep3-arabic-ar` today and the tutor would teach Arabic **in English**, under the
**maths** grounding rules, offering **`pair_plotter` and `product_builder`** instead of
`irab_builder` — with no error anywhere. The app would look like it worked.

The same shape exists in the database. `node_subject` (migration 006) is a hardcoded two-arm CASE:

```sql
CASE c.id WHEN 'course:prep3-social-ar' THEN 'social'
          WHEN 'course:prep3-math-en'   THEN 'math'
          ELSE 'other' END
```

Arabic LOs would be `'other'` — a value no TypeScript type admits (`SpineSubject = "math" | "social"`),
so the graph, the per-subject averages and the subject filter would each mishandle it differently.

### 1.2 Where subject is hardcoded — 16 files + 1 DB view

| Area | Files | What is hardcoded |
|---|---|---|
| **Types** | `lib/types.ts` | `Subject = "math-en" \| "social-ar"`, `SpineSubject = "math" \| "social"` — closed unions |
| **Prompting** | `lib/lesson.ts` (~10 sites) | `LANGUAGE_CONTRACTS`, `groundingRules`, `reviewSubjectRules`, `sharedProtocol`, `learnPrompt`, `reviewPrompt`, gazetteer gating, teaching-script gating |
| **Queries** | `lib/subject-queries.ts`, `lib/queries.ts` | subject derivation + per-subject summaries |
| **Spine UI** | `spine/SpineExplorer.tsx`, `spine/GraphCanvas.tsx` | `SUBJECTS` array, labels, accent colours, territory bands, bridge arcs |
| **Student UI** | `student/page.tsx` (`COURSE_OF`), `SubjectHome`, `LessonCheckIn`, `LessonSession`, `ReportCard` | course↔subject map, RTL gating, per-subject copy |
| **Chat/viz** | `lib/viz-prompt.ts`, `lib/chat-parse.ts`, `lib/ask.ts`, `chat/CitationChip.tsx` | which widget catalogue and figure directives exist |
| **API** | `api/understanding/route.ts` | `data.subject === "social-ar" ? "social" : "math"` written into a DB column |
| **DB** | migration 006 `node_subject` | the two-arm CASE above |

### 1.3 Subject-blind copy already shipping wrong

Independent of Arabic, these are wrong *today* whenever a social lesson is on screen:

- `app/layout.tsx:105` — the global footer reads **“Prep-3 Mathematics · MOETE 2025–2026”** on every
  page, including social lessons. (Known cosmetic bug, now worth fixing properly.)
- `/spine` header — “Extracted from: **Mathematics — Student's Book**…” even when the social filter is
  active; it names the *first* source document rather than the selected subject's.
- `/pipeline` — narrated as one book's journey; the “run of record” panel is Social-specific.
- `/` overview — “174 learning objectives” etc. are cross-subject totals presented without a breakdown.

### 1.4 Student is hardcoded to one row

```
students: 1 row → (1, "Omar (demo)", "prep-3")
attempts: 649   mastery: 186   understanding_checks: 0
```
`STUDENT_ID = 1` is a module constant in **three** API routes (`ask`, `attempts`, `understanding`).
There is no student switcher, and no student with an empty history — so **the cold-start experience
(diagnostic → first lesson → first mastery) cannot be demonstrated at all.** Omar is permanently
mid-journey at 28% average.

---

## Part 2 — The plan

### Principle: one registry, not sixteen conditionals

Replace the scattered `=== "social-ar"` checks with a **single subject registry** — one module that
every surface reads. Adding subject #4 then costs one entry plus its prompt contract, not an audit of
16 files. This is the whole point of the change; adding Arabic as a third special case would leave the
next subject exactly as expensive.

```ts
// app/src/lib/subjects.ts  (new — the single source of truth)
export const SUBJECTS = {
  "math-en":   { key: "math",   courseId: "course:prep3-math-en",    label: "Mathematics",
                 labelAr: "الرياضيات", dir: "ltr", accent: "...", book: "…Mathematics…",
                 widgets: ["pair_plotter","product_builder","viz_ref"], contract: MATH_CONTRACT },
  "social-ar": { key: "social", courseId: "course:prep3-social-ar",  label: "Social Studies",
                 labelAr: "الدراسات الاجتماعية", dir: "rtl", …,
                 widgets: ["locate_on_map","timeline_builder","chain_builder","term_match"], … },
  "arabic-ar": { key: "arabic", courseId: "course:prep3-arabic-ar",  label: "Arabic",
                 labelAr: "اللغة العربية", dir: "rtl", accent: "aubergine (--subject-arabic)",
                 widgets: ["extract_spans","hamza_seat","style_purpose","irab_builder","term_match"],
                 contract: ARABIC_CONTRACT },
} as const;
```
Derived from it: the `Subject`/`SpineSubject` types, `subjectOfCourse` (exact match, **no
`endsWith` heuristic**), labels, colours, RTL, widget catalogues, `COURSE_OF`, and the language
contract lookup.

**The safety rule that replaces the silent default:** an unknown course must **fail loudly** (or
render a neutral "unknown subject" state), never quietly become maths.

### Wave A — the registry + de-hardcoding (no visible change)
1. Add `lib/subjects.ts`; derive the types from it.
2. Rewrite `subjectOfCourse` / `subjectOf` as exact lookups; unknown → explicit `null`, handled.
3. Repoint the 16 files at the registry. **Regression bar: maths and social prompts must be
   byte-identical** (the same proof used in ADR-0004 Wave 0 and the Arabic Wave-0 schema change).
4. Migration 007: replace `node_subject`'s CASE with a lookup that derives subject from the course id
   generically (or a `courses.subject` column — recommended, so SQL stops encoding product facts).

### Wave B — Arabic as a first-class subject
5. Arabic entry in the registry + `ARABIC_CONTRACT` (language/voice, grounding rules incl. the sacred
   rules from `arabic-sensitive-content.md`, cumulative-grammar scope) in `lesson.ts`.
6. Wire the Arabic widget catalogue into the lesson prompt so the AI can emit
   `{{widget:extract_spans:…}}` etc. (Track B built the components; nothing can emit them yet.)
7. Spine: third territory + accent (aubergine `--subject-arabic`, already in `globals.css`), subject
   filter, per-subject averages.
8. Student: third subject card, `?subject=arabic` routing, RTL check-in.
9. `understanding_checks.subject` accepts `arabic` (migration 007).

### Wave C — subject-blind copy (fixes bugs shipping today)
10. Footer, `/spine` header, `/pipeline`, `/` overview become subject-aware: name the **selected**
    subject's book, show per-subject totals, and drop the global “Prep-3 Mathematics”.

### Wave D — demo student switching ("from scratch")
11. `students` gains a second and third row: **a fresh student with zero attempts/mastery** (the
    cold-start demo) and optionally a strong one. Seeded by `load_seed.py --demo-student`.
12. Replace `STUDENT_ID = 1` in the three API routes with a resolved student from request context.
13. A **demo student switcher** — same treatment as the existing as-of toggle: a small control on
    `/spine` and `/student`, persisted in a cookie so API routes see it too. Explicitly a demo
    affordance, not auth (auth is a PRD §3 non-goal).
14. **The payoff:** switch to the fresh student and the whole product tells the cold-start story —
    graph all-grey at 0%, "no attempts yet", the diagnostic as the natural first action, then mastery
    visibly moving after the first lesson.

### Sequencing & risk
- **A before B** — adding Arabic on top of the current conditionals would triple the mess.
- A is a pure refactor with a hard regression bar (byte-identical prompts); B/C/D are additive.
- D is independent of A–C and can run in parallel.
- Wave C fixes two bugs that are **already visible to your co-founders** on the live site.

### Open questions for Samuel
1. **Arabic accent colour** — the design-system spec proposes aubergine `--subject-arabic`. Confirm.
2. **Student switcher visibility** — always on, or behind the existing triple-tap debug affordance so
   students never see it?
3. **`courses.subject` column** vs deriving from the id in SQL — the column is cleaner and stops the
   database encoding product facts, but it is a migration on a live DB.
