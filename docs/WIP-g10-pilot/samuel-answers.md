# Samuel's answers, 2026-09-25 (one-by-one round)
1. Hotfix v0.9.3: "Full fix + deploy (Recommended)" — incl. sign-flipped note sentence (ADR-0020 4th exception).
2. Marker (T413 → ADR-0025): "Build our own (Recommended)".
3. Marking rules (form required / unreadable → retype / no printed answer → EPUB solution + listed at G2): "As recommended".
4. Prerequisite links for G10: "Yes, find them (Recommended)" — new stage, second AI checks, approved at G1 with objectives.
5. Figures no existing type can draw: "You should create widgets for those" — build native figure/widget types (geometry, trig graphs, 3-D solids), NOT static book images. Needs a figure-gap inventory + sizes.
6. New widget types: "All six (Recommended)" — shape builder, extended curve sketcher, Venn, box plot, algebra tiles, 3-D solid scaler.
7. Constitution v3.3 → v3.4 (curriculum truth per course, etc.): "Yes, update it (Recommended)" — explicit approval.
8. Load-a-course restore mode via GitHub: "Yes, add restore (Recommended)".
9. American-track language: "English only (Recommended)" — keep "Egyptian student", no Arabic phrases; per-course setting.
10. Misconception checks: "Per topic (Recommended)" (~$22–32).
11. EPUB-only formula pictures: "Add a third reading" — when two readings disagree, a third independent AI reading decides (instead of holding). Update FR-4407 + S0b design.
12. Second blind mapper for the 1,228 chapter-end exercises: "Yes, double-check (Recommended)".
13. Arabic lessons real printed names: "Use the book's names (Recommended)" — ADR-0020 exception (prompt hold) for lesson titles.
14. Chapter 8 pilot: "go for the chapter 8 pilot when ready" — run after the pipeline dry run passes; G1 (objectives) comes back to Samuel as a question; load to a scratch DB only; measure both S0b settings.

15. (2026-09-26, Chapter 8 pilot, S1) End-of-chapter questions that fit no objective → "Both":
    (c) objective finders also read the end-of-chapter questions in scope for their lesson, so a skill practised
    only there gets its own objective; and (b) a new G1 verdict "outside this chapter's objectives" — the item is kept
    out of practice and listed in the coverage report (rule 2 relaxed only under that named human decision).

16. (2026-09-26, isolation fixes) Open chat after an access/curriculum change → "Next turn (Recommended)": the next
    turn reads the new scope; FR-4011 and its edge case are reworded to match (was: the snapshot lives until the chat ends).
17. (2026-09-26, isolation fixes) National prompt for a student who cannot see the bridge's/handoff's target course →
    "Allow (Recommended)": the no-handoff line and dropping the hidden course's bridge are a named exception to the prompt
    hold (ADR-0020, recorded under FR-4206 like the Ask book-list difference); and handoff cards to a hidden subject are
    also stripped server-side, so a student never lands on a not-found page.

G2, Chapter 8 (2026-09-26), asked one topic at a time:
18. The 60 routine items → "Approve (Recommended)": as recommended = 34 accept, 24 fix (book errors corrected where
    the independent re-solve is right; our typing/part-numbering fixes), exclude Ex8-4:1c and Ex8-4:14. (The question
    text said "33 accept, 27 fix"; that count was the orchestrator's slip — the item list shown and approved is the
    24 fixes applied.)
19. Several points in one answer (Ex8-1:2, Ex8-6:1, Ex8-6:39b) → "Teaching only": worked examples, not marked.
20. More than one true shape name (Ex8-6:36b, 42e, 21c) → "Most specific only (Recommended)": the book's most specific
    answer is the key; another TRUE option is returned for re-entry ("true, but be more precise"), never marked wrong.
21. "Give reasons" questions (Ex8-6:19d, 22e) → "Mark the name, discuss reasons (Recommended)".
22. One-offs, decided individually: Ex8-6:24a → "Mark answer only" (key √34, the tutor gives no step-by-step
    explanation: the book has no working); Ex8-6:33a → "Keep as printed" (answer "no value of k");
    Ex8-5:5 → "Exclude now and let us review in details later".
23. (2026-09-26, G2) Ex8-6:36b, key "square" but the book's solution concludes "rhombus" → "Add one line (Recommended)":
    append to the stored solution "LM ⊥ MN and all four sides are √26, so LMNP is a square." — a correction Samuel
    approved; the rest of the book's working unchanged.
24. (2026-09-26, G2 follow-up) Typos inside the book's working, final answers right → "Correct both (Recommended)":
    Ex8-6:32d "Substitute A(−2; 2)" → A(−1; 7); Ex8-6:45a "9 − 5" → "9 − 4". Recorded as corrections Samuel approved.
25. (2026-09-26) Ex8-6:32d, the same typo carried into the next line → "Correct it too (Recommended)":
    "(2) = −(−1) + c" → "(7) = −(−1) + c" (gives the book's c = 6). Recorded under decision 45's approval.
26. (2026-09-26, S7) Widget templates where the blind checker rejected some "mistake → misconception" claims
    (all 25 widgets answerable; 20 claims confirmed, 23 rejected; the all-or-nothing rule would leave 0 widgets) →
    "Keep them, and let's human review": keep all 7 widget templates; the rejected claims go to a human review
    instead of being auto-dropped. Orchestrator's implementation: until reviewed, a rejected claim is held (never
    shown to a student, never used as evidence); the reviewer confirms or drops each one.

Consistency-review decisions (2026-09-27), one at a time (decisions.md decisions 48–55):
27. "Load a course" restore (answer 8 / FR-4208/4210) → "Build the safe restore (Recommended)": restore replays a
    previously exported, reviewed bundle for one course, keeping every student's progress or refusing; today's
    whole-database rollback stays as a separate, clearly named emergency `rollback` mode, documented as undoing
    student data. (decision 48.)
28. Grade gate default (AINEXT_COURSE_GATING) → "Refuse to start (Recommended)": in the student product (mvp1) the app
    refuses to start unless the setting is explicitly on or off, with a clear message; production (already on) unchanged.
    (decision 49.)
29. Figures for the other 13 chapters → "Native only, wait": decision 26 stands strictly — no book images; a question
    whose figure needs a native type that doesn't exist yet stays held until that type is built (chapters may launch
    with large held sets). (decision 50; temporarily reversed for students by answer 37d, decision 58d.)
30. Step-level working checker → "Yes, add it (Recommended)": one checking agent per book solution + a free numeric
    pre-check; flagged steps go to G2, never silently corrected; ≈$0.03–0.05/solution; re-run on Chapter 8 too.
    (decision 51.)
31. Live Prep 3 fixes (14 dead widget links; angle widget opening on its own answer) → "Ship as a small hotfix
    (Recommended)": split out of the Grade 10 branch into a small release off main (like v0.9.3) — data migration for
    the widget links + the opening fix, CI, deploy only on Samuel's explicit go. (decision 52.)
32. Misconception tags on "true but less precise" options → "Remove those tags (Recommended)": such an option is never
    a mistake; the pipeline refuses misconception tags on it and S5 is told which options they are. (decision 53.)
33. What counts as "reviewed" → "Only human stamps count (Recommended)": a question is reviewed only when a human
    signed it; AI-only checks show in the console as "AI-checked, awaiting human"; nothing changes for students;
    applies to Prep 3 too with the next release. (decision 54; FR-4506.)
34. A decimal comma typed in a Grade 10 numeric answer ("7,21") → "Accept it as a decimal (Recommended)": read as 7.21
    and marked normally when unambiguous (a clear pair in a coordinates answer stays a pair); Prep 3 marking unchanged.
    (decision 55.)
35. (2026-10-01) The console showed the American Grade 10 course with an Arabic subtitle («الرياضيات», the shared
    maths subject's Arabic name) → "change , this is american course we said no arabic": the American course shows
    no Arabic anywhere — console and student surfaces, its lessons, the American curriculum's name — chosen per
    course (the `arabicTouches` setting), every National course unchanged. Read as also answering consistency-review
    B7: the G10 tutor's "write no Arabic at all, even if the student writes in Arabic" line is KEPT. FR-4205 widened.
    (decisions.md decision 56.)
36. (2026-10-01) Sign-up showed no curriculum question for Grade 10 (only American is live there), per decision 1
    ("ask only when the grade has live courses in two or more curricula") → "yes the sign up should always ask":
    REVERSES decision 1. Sign-up (password and the first Google sign-in step) always asks which curriculum the
    student follows, naming every curriculum, pre-selecting none, and the account is not created without an answer.
    Orchestrator's default, to confirm: a curriculum with nothing live yet for the chosen grade is still offered and
    selectable, with a short note saying there is nothing to study there yet. (decisions.md decision 57.)
37. (2026-10-01) "How do you want to fill the Grade 10 American course?" → Samuel: "I am on an early phase, and I
    always always want to see the whole extraction appear. And let's prepare in the console a review gate, just
    internal and the aim will be that the console has zero backlog, so I, Tamer and Kamil will be reviewing one by
    one, but this is for us, and keep the student always full as if everything has been reviewed as for now we are
    the ones who use the app for testing, so please consider and fan out the full book for me, and in the background
    create agents with the review process so we can review from the console page." Follow-ups, same day:
    a. Students always full (MATHS ONLY — "Maths only (Recommended)"): everything extracted for a maths course goes
       live to students as if reviewed; review status stays internal (console only). Social Studies and Arabic keep
       their review queue; Quran/Hadith stay sealed regardless.
    b. Internal console review gate: every item without a human stamp is a backlog item; Samuel, Tamer and Kamil
       review one by one; the goal is zero backlog. (Only human stamps count — answer 33.)
    c. Gates G1–G4 during the fan-out → "Auto-pass, review later (Recommended)": the pipeline proceeds on the AI
       checks' recommendation; every decision lands in the console backlog; automatic safety checks (broken maths,
       answers vs the book, parity) still block.
    d. Figures no native type can draw yet → "Book picture for now": show the book's own image until the native
       figure exists. TEMPORARILY REVERSES answer 29 for students; each such question stays in the backlog as
       "needs native figure".
    e. Fan out the full book (the other 13 chapters, ≈ $0.85–1.1k) — approved.
    (decisions.md decision 58; FR-4501…FR-4509.)
38. (2026-10-01) "I want the students to see all chapters as well not only 8! you did ingest the full book" →
    the whole book is read (EPUB text, figures, and S0b maths for all 14 chapters; G0 manifest: 14 chapters,
    65 lessons), but only Chapter 8 has been through the teaching stages (objectives, lessons, solutions,
    questions). Orchestrator's implementation: the student sees the whole book now — every chapter and lesson
    in the manifest's order — with not-yet-prepared lessons visible but not startable ("Being prepared"), each
    becoming startable automatically when the fan-out loads it. Grounded teaching unchanged: nothing is taught
    from an unprepared lesson. (decision 59)
38a. (2026-10-01, decision 59 follow-ups, verbatim) Whole-book list for Grade 10 → "Open by default (Recommended)";
    tell Noor which chapters are being prepared? → "no leave it as it is , I will land them all now as soon as you
    finish" (Noor's prompts unchanged); course card → "\"5 of 65 ready\" (Recommended)". Skill-map strip placement
    accepted as built (orchestrator's call, not asked).
39. (2026-10-01, decision 60) Does the gate auto-pass (answer 37c, G1–G4) also cover G5, the final go/no-go
    (dry run, coverage, drift, cost)? → "YES, and Make sure to mark them for my review in the console view":
    G5 auto-passes too; every auto-passed gate decision (G1–G5) is recorded and shown in the console backlog
    as a gate decision for Samuel, cleared only by him. G5 passing deploys nothing — production moves only on
    Samuel's explicit go, through CI.
40. (2026-10-01) 8.1 "Drawing figures from coordinates" (lo:g10m8s1-1-1) has no book question — its six book items
    are drawings marked teaching-only, and every generated family must hang off a book question (FR-1101) →
    "Allow a teaching item as parent (Recommended)": change the rule so a family may be modelled on a book
    teaching item; the family goes live, marked for review. NOT YET IMPLEMENTED — held with the fan-out (below).
    Same day: the fan-out's cost question ("keep going until the whole book is done?") was dismissed by Samuel
    — "do not proceed, wait for next instruction". No new runs launched after 002 (wf_957393ec-d74, Chapter 8
    working check) and 003 (wf_bfd09dab-0e6, S0b pass A, chapter group 1), which were already running.
41. (2026-10-01) After the pause, on the map question ("placeholder cards would not be linked") → "wait for the fan,
    I charged my credit, continue, but sonnet 5.5 please": no placeholder topic cards; the fan-out CONTINUES to the
    whole book (this is the go-ahead the dismissed question asked for). Every agent and run on Sonnet ("sonnet" =
    Sonnet 5, the newest Sonnet available; pipeline stages already pin it, with Haiku only for small yes/no checks).
    Runs 002 and 003 resumed under their run ids; answer 40 and the remaining spec FRs handed to Sonnet agents.
42. (2026-10-01) S0b group 1 pass A measured $0.040/image vs the plan's $0.024 (whole book ≈ $1.1–1.4k metered) →
    "keep the quality, continue, actually I raised the credit that you can proceed as you want for the quality
    higher": keep the full-quality method (no cap on hash-proof attempts); the orchestrator may choose
    higher-quality options without asking about cost. Orchestrator's first use: the "never two S0b passes at once"
    usage-limit rule is relaxed — S0b passes of different chapter groups run in parallel (packets are deduplicated
    across groups at prepare time, so no image is read twice).
43. (2026-10-01) Multi-part exercises: when a later part depends on an earlier part, what does the student see in the
    later part on its own? → "The value from the book (Recommended)": the carried sentence includes the book's own
    earlier answer (e.g. "m_MN = −1/3. Show that AB ∥ MN."), not only the names — multipart.py rules R1 (with key),
    R2 and R3 stand as built.
44. (2026-10-02, decision 65) Chapter 13's lesson g10m13s1-1 has two objectives; lo:g10m13s1-1-2 (area as an
    algebraic expression) has exercise evidence only, so the orchestrator ruling drops it, which would leave the
    lesson with ONE objective and fail G1 rule 4 (2 to 5 per lesson). Relax the minimum? → "Allow 1 after ruling,
    but keep a note so we can check later": a lesson may keep one objective only when G1 dropped another under a
    recorded ruling; it is a warning marked CHECK LATER (machine-readable `check_later`, first `for_review`
    entry of the gate record), never with none left, never over 5, never without a ruling.
45. (2026-10-02, decision 66) Chapter 5's G5 is blocked by parity: the database counts 1433 questions against the
    bundles' expected 1392, and 212 visuals against 209 — the difference is the 41 Chapter 1-4 book questions the
    G2 recommendation runs rejected (kept for the audit trail, never served) plus 3 book-picture visuals attached to
    them. How should parity treat rejected rows? → "Count only servable (Recommended)": parity counts questions that
    are not rejected/retired, and only the visuals attached to them; rejected rows stay in the database.
46. (2026-10-02, decision 67) On moving the branch `feat/003-curriculum-tracks-g10-american-math` onto `main` after v0.11.0
    (the Your Progress Map) replaced the skill-map code this branch had built on. Four parts; the quoted words are the options he chose:
    a. How should the branch sit on `main`? → "One commit on main (Recommended)": the branch becomes `origin/main` at v0.11.0 plus ONE
       squashed commit carrying all of feature 003; the full history (678 commits, almost all 30-second auto-snapshots, forked
       from `main` at v0.9.3) stays whole under a tag.
    b. What are the two tags called? → "g10-old-graph-view / g10-progress-map (Recommended)": `g10-old-graph-view` marks the old
       history (it still has the old skill-map view and the FR-4315 section frames); `g10-progress-map` marks the new single commit.
    c. FR-4315 (a split section's parts drawn as one group on the map) was built in `GraphCanvas`, which `main` deleted → "Port the
       frames into the new map now": the frames are rebuilt on the Your Progress Map (`SkillMap.tsx`, `skill-map.ts` `placeSections`,
       test `skill-map-sections.test.mts`) before the commit, not left for later.
    d. When may the branch be pushed? → "Push once checks pass (Recommended)": the branch is force-pushed (with lease) to GitHub, with the
       new tag, once the checks pass. Nothing is merged to `main`, released or deployed by this.
    (decisions.md decision 67.)
47. (2026-10-02, decision 68) Which version number does this feature's release take? `main` already used v0.10.0 (Tamer's testing
    fixes, 2026-10-01) and v0.11.0 (the Your Progress Map, 2026-10-02), and `tasks.md` T390 still planned v0.10.0 → "T390 should be
    v0.12.0": the bump, the release notes (`docs/releases/v0.12.0.html`) and the changelog entry for feature 003 are v0.12.0.
    (decisions.md decision 68.)
