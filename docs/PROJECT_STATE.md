# Project State — AI Tutor MVP

> Living document. Read at session start; update when progress or decisions land.
> Last updated: 2026-07-17

## Phase
**PoC built (v0, 2026-07-17).** Working end-to-end slice of the spine: ministry book (Prep-3 Math EN, Unit 1) → content-addressed source + typed extraction (Pydantic, DAG-validated) → Postgres curriculum graph (11 LOs, 29 live questions, provenance on every fact) → adaptive student loop (Elo mastery, temporal rows) → **Evidence Walk demo** (investor-grade, ADR-0003 P0). Run: `brew services start postgresql@17`, then `npm run dev` in `app/` → http://localhost:3000 (/, /spine, /student). Reseed: `uv run load_seed.py seed/unit1.json --approve-all --demo-student` in `services/extraction/`.

## Done
- ✅ Ideation phase complete; product direction locked in PRD v1.0 (`AI.Next - Google Folder 17 Jul 2026/AI Tutor/PRD/PRD-ai-tutor-mvp.md`)
- ✅ Brainstorm materials downloaded locally (`AI.Next - Google Folder 17 Jul 2026/`)
- ✅ Virtual team created: 10 subagents + 3 skills + this state system (2026-07-17)
- ✅ **ADR-0001 accepted (2026-07-17):** solution architecture follows the Agent-Native Data Spine thesis; PRD §8 stack guidance discarded. Derived architecture drafted: `docs/architecture/spine-derived-architecture.md`

## In progress
- Samuel reviews the PoC (demo at localhost:3000; question content awaits his real review — bulk-approved for demo via `--approve-all`)

## FULL BOOK EXTRACTED (2026-07-19) 📗
All 178 pages of the ministry PDF (Term-1 + Term-2 books) are in the spine: **10 modules, 90 learning objectives, 112 prerequisite edges (incl. cross-unit and cross-term), 450 live questions (421 independently re-solve-verified by extraction agents, 0 unresolved discrepancies; unit1's 29 remain poc-bulk), 212 animated visuals.** Bundles: unit1–5, geo-unit1 (The Circle), t2-unit12 (Equations + Algebraic Fractions), t2-unit3 (Probability), geo-unit2a/b (Angles & Arcs). Load order matters (cross-refs): unit1→…→geo-unit2b, see loader. **Human review of the 450 questions remains the gate before any real student.**

## Tutor Experience v2 — SHIPPED (2026-07-18, spec: docs/specs/tutor-experience-v2.md)
All three waves verified: **A** (7 correctness bugs), **B1** (beat protocol + paced reveal, grounding slices + prompt caching — spine $0.28→$0.014/turn, lesson EGP 32-46→6-7 — latency theater, language lock, softened failures, de-instrumented student surface w/ triple-tap debug), **B2** (persistent whiteboard السبورة with figure/question focus + filmstrip, controlled-step figures across all 9 primitives — draw once slowly, tap-advance, no infinite loops — focus mode + labeled Arabic stepper, doors-first check-in with Term-disambiguated picker, sessionStorage lesson resume). Repo: https://github.com/samtoma/AI.NEXT (commit at each verified milestone).

## Samuel's standing directions (2026-07-18)
- **PoC quality over cost optimization.** Cost work is noted, not prioritized: grounding slices + prompt caching stay (pure wins), but model thinking is re-enabled on tutor turns with a bounded budget (6k tokens via `AINEXT_THINKING_BUDGET` in `app/src/app/api/ask/route.ts`) — deliberation on, 30–60s stalls capped. Cost instrumentation keeps running so the numbers are known when optimization becomes a priority (pre-pilot).

## Wave 2 — full-book scale-up (2026-07-17/18)
- **Curriculum now loaded: 6 units** — Algebra Term-1 Units 1–5 complete + Geometry "The Circle" (Term-2). Totals: **52 learning objectives, 59 prerequisite edges (incl. cross-unit), 240 live questions (211 independently re-solved/verified by extraction agents; Unit 1's 29 remain poc-bulk), 123 visuals.**
- **Book fully mapped:** PDF = Term-1 book (pp.1–75) + complete Term-2 book (pp.76–178: Algebra U1–2 + Probability U3 + Geometry U4–5). Remaining to extract: Term-2 algebra/probability (PDF 77–110) + Geometry "Angles & Arcs" (PDF 136–176) — plan in `services/extraction/seed/geometry-structure.md`.
- **Visual primitives system:** 9 animated SVG primitives (VIZ_SPEC.md contract) + /gallery page ("Every figure is data") + Evidence Walk LO strips + AI can push any primitive into lessons via `{{widget:viz:…}}`. Migration 004 (visuals table).
- GraphCanvas layout fixed for large graphs (dynamic height, normalized positions).
- Loader supports multi-bundle loads with cross-bundle refs + verified-flag statuses; migration order matters: unit1→2→3→4→5→geo-unit1.

## Demo v2 additions (2026-07-17 evening, for co-founder demo)
- **/pipeline "The Digestion":** 5-stage visual story of book→spine — real scanned pages + sha256 passport, actual Pydantic schema contract, reviewed question with stamp, graph summary, and a real grounding slice from ai_interactions ("178 pages in 5,225 tokens" with live token/cost receipt).
- **/student adaptive check-in:** "How did today's lesson go?" → **Learn mode** (AI-led interactive lesson: teaching beats, pair_plotter + product_builder widgets, check questions, 14-turn cap) or **Review mode** (non-annoying: 3 quick checks + 1 widget, hard 5-turn cap) or quiet practice. Both end in an AI-graded **comprehension report card** (0–100 score dial, verdict stamp, strengths/gaps, next step → `understanding_checks` table, migration 003). **Voice:** browser TTS + mic (Web Speech API, feature-gated, no keys).
- **Cost datapoints:** full learn session ≈ $0.17 (≈EGP 8) incl. rating; review ≈ $0.10; spine chat ≈ $0.045/turn. Caps bound worst case; per-mode budget lines needed for any student-facing version.

## Ask the Spine (added 2026-07-17, per Samuel: "more interactive, AI in the loop")
Glass-box grounded AI chat on /spine + /student: streams answers with inline receipt-chips ([[lo]]/[[q]]/[[page]] → graph highlight/provenance), pushes live question cards into chat (answers flow through /api/attempts → mastery ripples the graph), "still confused" re-explanation capped at 2 turns server-side, every turn logged to `ai_interactions` with cost/tokens/latency. LLM backend: local `claude` CLI headless (claude-sonnet-5, no API key needed on Samuel's machine) — swap to Anthropic API for any deployed environment. **Cost reality: ~$0.045/turn ≈ EGP 2.2 → ~17 chat turns/month hits the EGP 40 ceiling; prompt caching / trimmed grounding is the lever if chat ever ships to students.** Note: chat-tutor surface remains a PRD §3 non-goal for the student MVP — this is the investor/demo surface.

## Next
1. Samuel: review PoC + demo to co-founders; decide what Phase 1 hardening looks like
2. Remaining ministry book units (2–5) through the ingestion pipeline; then LLM extraction automation (variant_engine activates with API key)
3. Admin review tool (replace `--approve-all` with the real gate, provenance-aware)
4. PWA skeleton for the real student surface: auth (phone + OTP/magic link), mobile-first, offline queue (demo /student is desktop investor demo, not the production PWA)
5. Grade-10 source acquisition + Arabic edition (per PRD spearhead; ADR-0002 note)
6. Seed bank scale-up toward ≥ 400 questions (schedule risk — content, not code)

## Open questions (from PRD §12 + setup)
- Exact price point within EGP 250–400 band (after first 10 discovery conversations)
- Accept grade 11 students in cohort 1?
- Part-time math teacher hire for content review?
- Official ministry syllabus document acquisition
- Component selections (ADR-0002) — pending Samuel

## Decisions log
| # | Decision | Status |
|---|---|---|
| ADR-0001 | Architecture follows the data-spine thesis (PRD §8 discarded) | ✅ Accepted 2026-07-17 |
| ADR-0002 | AI runtime = Python service; app layer = Next.js/React; PoC content = ministry Prep-3 Math (English) | ✅ Accepted 2026-07-17 |
| ADR-0003 | Graph store: Postgres system of record + demo layer as P0 | ✅ Accepted 2026-07-17 |

## Key metrics to watch (once live)
50 paying families · ≥60% M2 retention · diagnostic score lift at day 45 · ≥3 sessions/week/student · <EGP 40/student/month AI cost
