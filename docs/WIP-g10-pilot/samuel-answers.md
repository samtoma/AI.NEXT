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
