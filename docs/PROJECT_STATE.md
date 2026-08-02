# Project State — AI Tutor MVP

> Living document. Read at session start; update when progress or decisions land.
> Last updated: 2026-08-02

## 📚 SPEC KIT ADOPTED — constitution + full A→Z baseline docs (2026-08-02, `wip/hardening-4`)
GitHub Spec Kit (`specify` CLI, offline scaffold) is now the requirements framework.
**Constitution v1.0.0** ratified at `.specify/memory/constitution.md` — ten principles codified
from CLAUDE.md/PRD/ADR-0001..0006 (authority, grounding, review gate, sacred containment,
Arabic/low-end first, cost, minors' data, non-goals, registry discipline, operational safety).
**Baseline as-built spec set** in `specs/000-baseline/`: spec.md (6 user stories, FR-001..062,
entities, success criteria), plan.md (architecture by ADR, flows, topology), data-model.md
(full schema + pydantic contracts + content shapes), contracts/ (api.md, chat-protocol.md),
quickstart.md. **Documentation map** at `docs/README.md` (the A→Z index). CLAUDE.md conventions
updated (stale "app/ not yet created" line fixed; Spec Kit flow documented). New features now
flow `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` into `specs/NNN-slug/`.

## 🎯 DEPLOYED (2026-08-02, PR #4 → main `d6db088`) — pointed teaching in Arabic lessons
Three field-report fixes live: (1) show_passage no longer re-prints the passage and every tutor
message must end on an ask (no more dead-ends); (2) span highlighting — quote (loose-matched)
for prose, آية number for sacred — marks the exact words in the pinned card; (3) context-
dependent views: "line" = inline excerpt card carrying ONLY the marked span (store bytes,
never model text), "context" = pinned-card highlight + chip. Capture harness: 0 non-Arabic
prompt diffs. Branches cleaned; fresh branch `wip/hardening-4`.

## 🚢 MERGED TO MAIN (2026-07-30) — one-exchange lesson UI + release review
السبورة is merged INTO the exchange (Samuel's call): sealed passage cards open the chat, figures/
questions/{{show_passage}} render inline, one wide column; fresh sessions open scrolled to the
TEXT. A 16-agent release review (5 dimensions, adversarial verify) confirmed 9 findings — all
fixed pre-merge, incl. two blockers: per-student scoping of session persistence + turn caps, and
the sacred guard extended to EVERY chat surface over the whole sealed corpus. Content refresh now
applies migrations 007+008 idempotently before loading; `--all --course course:prep3-arabic-ar`
resolves both bundles. To ship data to the live site: Actions → Content refresh → preview, then
course mode with course:prep3-arabic-ar.

## 📗 ARABIC FULL BOOK — extracted, related, reviewed (2026-07-30, `wip/multi-subject-app`, UNPUSHED)
**All 20 lessons of both terms are in the spine with a reviewed relationship graph.** 152-agent
parallel conveyor run (0 errors) → `assemble_arabic.py` → `seed/arabic-t1/t2.json`: 100 LOs,
296 questions (10 live via blind re-derivation, 286 held at review), 46 sealed passages, 116
vocab, 106 rhetoric, 157 rule clauses. **Relationship graph: 16 prerequisite edges** — the
grammar installment series the book prints (المنادى ×3، البدل ×3، المدح والذم→نعم وبئس→حبذا،
اسم الفاعل ×3→صيغ المبالغة→اسم المفعول→الزمان والمكان→مراجعتهما→اسم الآلة، التفضيل→صوغه) +
the T1U1 همزة seat chain; a 22-agent review VETOED 14 book-order إملاء edges and proposed the
morphology completions (adopted) + 4 cross-subject bridge candidates (in the report, NOT loaded —
Samuel curates bridges).

**Samuel's sealed-text concern — fixed and guaranteed:** sealed passages now pin onto السبورة
from the lesson's first message (`SealedPassageCard`, id-only `{{show_passage:…}}` directive), and
runtime containment FAILS CLOSED: `lib/sacred-guard.ts` scans the output stream (LOOSE 4-word
shingles, 96-char holdback) and kills any turn that quotes sealed text before it reaches the
student, logging a redacted audit row. Verified live: tutor teaches from the on-board آيات by
paraphrase + number, never quoting.

**Review findings register: `services/extraction/runbook/ar-review-report.md`** — 115 findings
(30 high). Fixed same-day: systematic page misattribution (section-anchored now), interactive
rule_ref ids, the edge vetoes. Remaining for humans/re-runs: 7 wrong answer-explanations (all at
review status), ~30 uncovered printed drills, re-run list (worst: ara2-3 آيات العلم — grammar+
إملاء sections lost), unit-opener objective pages, enrichment/misconceptions never extracted.
RhetoricType grew 9 book-printed labels (طباق، جناس، تصوير، مدح/ذم، شرط، استثناء، تنكير، تفضيل)
— **pending Samuel's sign-off as enum owner**. Sacred ledger: سفينة نوح transcript ≠ authorities
on آية ٣٦ (flagged, canonical stored) + 3 hadith passages flagged (no machine authority — named
religious-content owner). selfcheck 106/106 · containment sweep CLEAN · 48/48 app tests.

## ✅ ARABIC END-TO-END — working locally (2026-07-29, on branch `wip/multi-subject-app`, UNPUSHED)
**اللغة العربية is a third first-class subject: extraction → authority-verified seal → assembly →
load → visible + teachable in the app.** Verified in the browser: third filter chip + aubergine
territory on /spine (5 LOs), third subject card on /student, RTL lesson session with a live AI turn
that **referred to the sealed آية card by number instead of typing scripture** (containment held).
NOT deployed — pushing `main` deploys; see "to reach the live site" below.

**The three conveyor bugs — fixed, re-run GREEN on the sacred lane** (same run id `wf_dcb2de86-cfb`
resumed; output `runbook/ar-t1u1l1.run2.local.json`, untracked):
1. Quran lane per amended ADR-0006 §2 lives in **`assemble_arabic.py`**: the reported citation is
   fetched RAW (urllib, no model) from api.quran.com + api.alquran.cloud, diffed in COMPARE-VERIFY,
   canonical Uthmani NFC stored — seal reproduces the reference `27fe013d…` byte-for-byte. Both
   authorities agreed 2/2 AND the (now-Uthmani) transcript agreed → sealed unflagged. Any
   disagreement/fetch failure = FLAG record, load continues, passage held for a human.
2. TEXT schema: sacred passages arrive as per-ayah `units` (8/8 with ٱ preserved) + hardened SACRED
   prompt (رسم عثماني، no بسملة unless printed, no memory-typing).
3. SEGMENT captures «القضايا المتضمنة» (3/3) + rhetoric covers the objective's استفهام (7 notes,
   provenance 24/24). Blind إعراب re-derivation 4/4 agree → those 4 load live (social's bar).
   Coverage verdict stays RED on: oracle wants finer per-section counters, «اقرأ واستمتع» (نجيب
   محفوظ bio, p.13) not captured, and 2 استفهام shawahid from p.8 questions vs the printed 5-item
   مواطن box — conveyor iteration items for the 20-lesson rollout, none block this lesson.

**New pipeline pieces:** `assemble_arabic.py` (workflow output → validated SeedBundle
`seed/arabic-t1.json` + read-surface `seed/content/ara1-1.json`; rhetoric mapped onto the closed
enums; re-typed شواهد repaired INTO the sealed text via LOOSE-locate; extract answers become
SpanRefs or demote honestly to short). Loader: stamps `graph_nodes.subject` on courses, serializes
typed Arabic answers as tagged JSON into `correct_answer` (grader = `app/src/lib/irab.ts`), sacred
gate unchanged. Migration **008** widens the question-type CHECK. `selfcheck_arabic.py` **103/103**.

**Waves A+B+D of multi-subject-app — done** (Wave C copy fixes remain):
- **A (registry):** 16 files on `lib/subjects.ts`; regression proof = `app/scripts/capture-prompts.mts`
  renders every surface (49 lessons × learn+review × system/data/grounding + 6 ask surfaces) —
  **byte-identical main vs branch** against one DB (re-proven after Wave B). The one drift found
  (`(id 1)` hardcoded in the data block) became `(id ${studentId})`.
- **B (Arabic teachable):** ARABIC_AR_CONTRACT (registry), Arabic lesson-prompt kit + ask kit
  (grounding rules incl. the sacred hard rule; رأي invited per ADR-0006 — ADR-0004 §5 deliberately
  NOT copied), widget directives for the 5 Arabic widgets (irab_builder rule_ref gate in the prompt),
  read surface renders sealed passages (Amiri Quran lazy via QuranPassage, per-ayah ﴿٦٣﴾…) + the
  «مهارات لا نقيسها بأمانة» disclosure (خط/تعبير/تلاوة) + قضايا chips.
- **D (demo students):** switcher verified in browser both variants (bug found+fixed: corner hot-zone
  painted UNDER the z-10 footer — now portaled to <body>). Cold-start نور tells the 0% story on
  /student + /spine; Omar/يوسف switch back clean; cookie validated server-side. 48/48 `npm test`.

**To reach the live site (Samuel's call):** merge `wip/multi-subject-app` → `main` (deploys code),
apply migrations 007+008 on the box DB, then `Actions → Content refresh` with `seed/arabic-t1.json`
(never `--approve-all` — the loader hard-refuses sacred bundles anyway; never `down -v`).

**Open before students see Arabic:** Wave C subject-blind copy (footer/"Extracted from" still say
Mathematics); Arabic-teacher human gate for the 12 review questions + named religious-content owner
sign-off on the sealed passage; conveyor K=1 (contract says K=2/3 for non-scripture) + the coverage
items above before the 20-lesson rollout; span-level vs passage-level sealing decision (hadith inside
قاسم أمين's prose, T1-U2-L1); `/api/attempts` doesn't parse typed-answer JSON yet (safe — all typed
questions are review; the widgets grade client-side).

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

## 🚀 DEPLOYED — live for the team at ainext.reletix.com (2026-07-26)
The PoC is no longer localhost-only. It runs on Samuel's **Oracle OCI box as a co-tenant** of the
production `talent.reletix.com` stack, and is shared with the co-founders by email invite.
- **Where:** isolated Docker stack at `/opt/reletix/AI.NEXT` (beside `talent/`, `talent-preprod/`).
  App binds **`127.0.0.1:3100` only**; Postgres is not published to the host. `down -v` removes it clean.
- **Exposure:** the box's **existing token-managed cloudflared container** (`network_mode: host`) serves
  one added public hostname → `http://localhost:3100`. **Ingress is managed in the Cloudflare Zero Trust
  dashboard, NOT a local config.yml** — `cloudflared tunnel route dns` / `systemctl reload cloudflared`
  do not apply. Locked behind **Cloudflare Access** (Allow → Include → Emails; one-time-PIN login).
  Verified: `https://ainext.reletix.com` 302s to `reletix.cloudflareaccess.com/.../login` — never public.
- **AI runtime:** the bundled `claude` CLI runs on Samuel's **Claude subscription** (one-time OAuth login,
  persisted in the `claude_cfg` volume — survives every redeploy; only `down -v` wipes it). **No API key**,
  no per-token bill. (Supersedes the older "swap to Anthropic API when deployed" note below.)
- **CI/CD:** one gated `.github/workflows/ci-cd.yml` — `build` (ubuntu-latest: tsc + next build) →
  `deploy` with **`needs: build`**, so a broken build never reaches the box; deploy runs on the
  self-hosted runner `ainext-oci-1`, main-only, build-on-box (ARM). Push to `main` = deploy.
  `POSTGRES_PASSWORD` lives only in `/opt/reletix/AI.NEXT/deploy/.env` (untracked; survives `reset --hard`).
- **Shared-box safety rails:** never `docker system prune` / `image prune -a` / `builder prune` (they hit
  the *shared* daemon); the pipeline only prunes untagged rebuild leftovers. Never touch talent stacks.
- Runbooks: `deploy/DEPLOY.md` (bootstrap + Cloudflare steps + content refresh) and `deploy/CICD.md`.

### Content refresh path — SHIPPED (2026-07-29)
New curriculum can now reach the live site **without `down -v`** (which would destroy the Claude
login). Code and data are separate pipelines: `ci-cd.yml` ships code, the new manual
`refresh-content.yml` ships data; they share one concurrency group so they never overlap.
- **Actions → "Content refresh (manual)"**: `preview` (default — runs the whole load in a
  transaction against the real DB, prints a before/after table, rolls back) → `course` (backs up
  with `pg_dump --clean --if-exists`, then replaces one course's subtree in one transaction, site
  up) → `full-reseed` (restores `deploy/db/ainext_poc.sql.gz` whole) → `restore` (rollback).
  Driver: `deploy/refresh-content.sh`; loader runs in a `profiles: ["tools"]` container so
  `up -d` can never start it. **`--approve-all` is unreachable from this path.**
- **Loader fixes it forced:** scoped reload of a bridged course FK-failed (PROJECT_STATE task #6) —
  now bridges are detached and re-attached verbatim; `--all --course <id>` picks a course's bundles
  (and load order) automatically, excluding superseded ones (`social-skeleton` vs `social-t1`);
  shared program root no longer trips the collision guard (math scoped reload was impossible);
  source-doc sha256 is reused from the DB where the gitignored PDF is absent, so provenance stays
  continuous on the box; `--dry-run`; DSN from `$AINEXT_DB_DSN`.
- **Known content consequence:** a math refresh demotes Unit-1's 29 `--approve-all` questions to
  `review` (933 → 904 live). The gate working as designed — but it makes the admin review tool
  (Next #3) the blocker for refreshing math.
- Backups land in `/opt/reletix/AI.NEXT/backups/` (0600, gitignored — they contain student rows).
  `deploy/make-seed-dump.sh` regenerates the first-boot dump and **refuses to run if the source DB
  holds a non-demo student** (pilot data is minors').
- **Perf:** runtime thinking budget cut 6000 → **1024** (`AINEXT_THINKING_BUDGET`; `0`/`off` disables) —
  the hard reasoning already happened at extraction time, so this is latency, not quality.

## FULL SOCIAL BOOK — Phase B SHIPPED, reviewed & loaded (2026-07-21)
The entire Term-1 Social Studies book (14 lessons, 4 units, geography+history) is extracted at the **rich** contract, independently reviewed, and live. Spec: `docs/specs/rich-content-fullbook.md`.
- **Richer contract:** every lesson now yields tamheed + per-subtopic exposition passages, key_terms (مفاهيم أتعلمها), enrichment boxes (معلومات إثرائية), misconceptions, style-varied questions (recall/explain_why/compare/consequence/order/locate/concept), and 3–5 widgets incl. interactives. Rendered by a new student surface (`app/src/components/student/LessonContentView.tsx`, `mode=read`) reading `services/extraction/seed/content/<lessonId>.json` via `getLessonContent`.
- **DB (loaded):** 84 social LOs across all 14 lessons, **762 questions (483 live / 279 review)**, 34 map visuals, 4 unit modules, 2 bridges preserved, math 450 untouched. Spine now shows **174 LOs / 933 live questions** total.
- **Pipeline:** `rich-lesson.workflow.js` (auto-segments each lesson; tiered Haiku+Sonnet; per-subtopic fan-out; coverage oracle). Assembled by `assemble_fullbook.py` + `merge_final.py`.
- **Review pass (all agents' work audited):** 0 MCQ answer errors across 754 Qs (independent re-solve). Sonnet re-audit of 33 Haiku-flagged claims → 29 valid (87%); **4 real defects found & dropped** (soc3-1 17th→18th-c date error; soc1-3 two over-claims; soc3-2 one unsupported) + 3 dependent questions. soc2-1/soc2-3 re-run to GREEN. Session-limit cascade (soc2-3 only) recovered via targeted re-run.
- **Base maps:** 4 continent maps (europe/n-america/s-america/australia) added to `generate.cjs`; registered in `maps.ts` BASE_MAPS (was silently blanking them). 24 gazetteer places added for U2–U4.
- **Follow-ups:** widget map_scene yield low (34 loaded — many proposed places outside gazetteer, pruned); stale "PREP-3 MATHEMATICS" footer on social pages (cosmetic); 279 review-status Qs await Samuel's pass; loader-hardening + cost-meter (task #6).

## Extraction Line — ADR-0005 accepted; Phase A SHIPPED (2026-07-21)
Root-cause finding: there was **no extraction pipeline** — seed JSON was hand-authored, so Geography Unit-1 Lesson-2 (تضاريس العالم) shipped **Africa-only** (a six-continent lesson) and Unit-1 L1/L3 were never authored. Fix (ADR-0005, spec: `docs/specs/extraction-pipeline.md`): a per-lesson **agentic conveyor** — segment→outline/LO→claims→questions→visuals→independent-verify→assemble+validate→human-gate→load — whose load-bearing addition is the **coverage oracle** (printed objectives/headings vs content produced) that makes "one continent of six" structurally impossible to reship.
- **Substrate:** Claude Workflow `services/extraction/runbook/extract-lesson.workflow.js` (reusable runbook); tiered models (Haiku mechanical, Sonnet content/verify, grader≠author); Stage-0 manifest `services/extraction/manifest/social-prep3-t1.json` (printed page = PDF index − 7, all 14 term-1 lessons).
- **Phase A result (Geography L2, all 6 continents):** first run RED — coverage oracle **caught a page-boundary bug I planted** (Asia's fluvial plains sat on a page assigned to Africa); fixed via cached resume → **GREEN**. 66 claims, 35 questions (was 17 Africa-only), **0 MCQ contradictions** on independent re-solve, Pydantic+DAG valid. 7 low-severity Haiku provenance flags for spot-check. Bundle `seed/social-t1.json` **loaded** (`--course` scoped): social 62 Qs (35 geo live=20/review=15 + 27 history preserved), 2 bridges restored, math 450 untouched. Verified live on /spine.
- **Loader gap found:** `--course` reload of a bridged node FK-fails (bridge preserved but endpoint node deleted) — worked around by drop→load→re-apply `db/bridges.sql`; proper fix queued (task #6). Workflow cost not yet piped to `ai_interactions` (task #6).
- **In flight:** visual fast-follow (Samuel chose the quality path) — design-system-lead building 4 missing base maps (europe/n-america/s-america/australia) in `app/public/maps/generate.cjs`; per-continent map_scenes wired after. **Next:** Phase B (Unit-1 L1/L3 + rest of term-1), Phase C (back-audit math + old skeleton with the coverage oracle). 15 short-answer Qs await human review.

## Multi-Subject Spine — Wave 1.5 SHIPPED (2026-07-21, ADR-0004; spec: multi-subject-spine.md)
Subjects are now separated everywhere, bridged by exception. Verified live:
- **Graph territories:** Evidence Walk splits into per-subject territories (math ink/viridian, social sepia/ochre) with a subject filter (All / Mathematics / الدراسات الاجتماعية); per-subject avg (never blended).
- **`relates_to` bridges (the "revolutionary" hint):** new cross-subject, non-prerequisite edge type (migration 006: rationale column + edge_type CHECK widened; `node_subject` view; understanding_checks.subject). 2 curated bridges in `db/bridges.sql` (map-reading↔coordinate-plane; campaign-route↔distance-between-points) — honest scope; more unlock in Wave 2. Rendered as gold arcs + in LoPanel "cross-subject connections" with bilingual rationale. Loader preserves relates_to across scoped reloads.
- **Cross-subject chat handoff (Samuel's core Q):** lesson prompt rule → `{{switch_subject:...}}` → warm handoff card (open the other subject / stay); NEVER answers out-of-subject inline (keeps grounding honest). Bridge-aware hint in lesson grounding (getLessonBridges).
- **Per-subject home + ratings:** `/student` → SubjectHome (two subject cards, per-subject mastery/weakest/last-check, never blended); check-in filters by ?subject; understanding_checks tagged by subject.
- 3 background agents stalled (watchdog) mid-build; coordinator finished all three tracks by hand. tsc + build clean, all pages 200. **Handoff card is code-complete but only the graph/home/bridge were live-screenshotted; the card firing needs one real cross-subject AI turn in a demo.**

## Social Studies — ADR-0004 accepted; Wave 0 SHIPPED (2026-07-20)
Samuel accepted all recommendations (voice vendor deferred). Wave 0 complete & verified:
- **Viz v2:** 7 Ledger SVG base maps + Arabic gazetteers (`app/public/maps/`), map_scene / RTL timeline / flow_chain primitives, 4 widgets (LocateOnMap, TimelineBuilder, ChainBuilder, TermMatch) — all step-driven via the core seam; VIZ_SPEC v2 with canonical place-name lists.
- **Subject-keyed prompts:** subject detection via course join; Arabic-first social-ar contract (book-wins, refuse-outside, sensitive-content hard rules per ADR-0004 §5); math prompts proven byte-identical (worktree diff). Wave-1 extraction contract: `docs/specs/social-extraction-contract.md`.
- **Loader multi-course:** per-bundle source docs, `--course` scoped subtree replace, cross-course collision guard, live-DB external refs; math reload identity proven by row counts; latent `--all` FK-order bug fixed.
- DB restored to math-only after tests. **Wave 1 next:** skeleton geo+history lessons end-to-end, RTL lesson-surface flip, ask.ts per-course source-doc fix, demo-student course scoping. Extraction agents must use `lo:soc<unit>-<lesson>-<n>` slugs (contract §1.2).

## Social Studies vertical — PROPOSAL delivered (2026-07-20)
Second subject on the spine: ministry Prep-3 دراسات اجتماعية (Arabic, 186pp, 8 units/30 lessons, geography+history). Three specialist reports + unified proposal in `docs/specs/` (proposal-social-studies.md is the entry point). Same 6-stage pipeline, 3 adaptations: LOs from the book's own ministry objective panels; verification = independent grounded cross-check + trap set (replaces arithmetic re-solve); model answers with per-claim page evidence. New: 4 interactive primitives (map_scene/locate, RTL timeline/builder, chain_builder, term_match), Arabic-first language contract, Azure ar-EG voice rec, RTL route flip. **Awaiting Samuel's Wave-0 decisions (proposal §6): question policy, voice vendor, maps build, Term-1-first scope, sensitive-content stance.** Key surprises: book has ZERO printed exercises (bank fully authored) and declares figures/years non-examinable.

## Voice / TTS (2026-07-20)
Web Speech API is inherently robotic (plays OS voices; weak for Arabic). Added a **provider-abstracted neural TTS layer** — `/api/tts` route + `app/src/lib/tts/` (ElevenLabs impl, disk audio cache keyed by text-hash, mock provider for tests) + `tts-client.ts` (`speakRemote` → plays mp3, falls back to Web Speech on 501/error). **English-first** per Samuel (Arabic/Azure ar-EG later — provider abstraction makes it a drop-in). Also fixed the Web Speech async-voices bug (first utterance was silent). **To activate:** set `ELEVENLABS_API_KEY` in `app/.env.local` (see `app/.env.example`); until then the hardened Web Speech fallback runs. Cost note: audio cached by hash → repeated lines free.

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
| ADR-0004 | Social Studies vertical (2nd subject on the spine) | ✅ Accepted 2026-07-20 |
| ADR-0005 | Agentic extraction pipeline + coverage oracle | ✅ Accepted 2026-07-21 |
| ADR-0006 | Arabic Language vertical — new contract: vendored Quran corpus, Noto Naskh font, 5 assessable LOs/lesson, scope = text+grammar+إملاء | ✅ Accepted 2026-07-28 |

## Key metrics to watch (once live)
50 paying families · ≥60% M2 retention · diagnostic score lift at day 45 · ≥3 sessions/week/student · <EGP 40/student/month AI cost
