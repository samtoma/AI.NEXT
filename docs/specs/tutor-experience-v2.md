# Spec: Tutor Experience v2 — "writing and drawing"

- **Status:** Approved direction by Samuel (2026-07-18: "very tutor-like… as if someone is writing to him, and drawing to explain"); synthesized from 3-agent review panel (UX / AI-pipeline / frontend)
- **Owner agents:** ai-engineer + frontend-engineer (two sequential implementation waves after bug fixes)
- **Do not break (all three reviews agree):** the beat discipline + two suggestion chips ("لسه مش فاهم" / "Got it ✓"); the defensive directive parser; figures-as-data (9 primitives, one `makeAnim` seam).

## Wave A — correctness bugs (in flight)
patchLast race, auto-continue drop, scroll fight, raw-LaTeX flash, `*emphasis*`, geo_scene label clipping. (+from UX review: duplicate suggestion-chip send dedupe.)

## Wave B1 — cost, grounding, protocol (CORE)
1. **Per-session grounding slice for spine_chat** (today: 39.9k tokens/$0.28/turn — full catalog). Slice like lessons; restore graph-as-index. Target ≤$0.03/turn.
2. **Cache-stable data block:** snapshot mastery at session start (or move volatile lines to suffix) — live mastery lines currently bust the prompt-cache prefix on every answer. Split cache_read/cache_creation columns in ai_interactions (migration 005) for observability.
3. **`{{beat}}` protocol:** bare-keyword directive (reuse DIRECTIVE_KEYWORDS machinery). Prompt rules: 2–4 beats/message, ≤2 short sentences (≤25 words) or one figure per beat, LAST beat = the single interactive directive. Review mode exempt (one beat). Cuts calls ~2.5×; with caching + slices, full learn lesson ≈ EGP 5–6 (vs 32–46 today).
4. **Paced reveal (client):** buffer stream ahead; reveal beat-by-beat at reading cadence (word-cadence reveal, ~700ms holds at beat boundaries, catch-up easing ≤2s); per-beat wipe-in. Gate TTS, graph-cite pips, finish handling, and auto-continue on REVEAL completion, not stream completion. MessageRow memoization prerequisite. prefers-reduced-motion → instant.
5. **Latency theater:** lesson surfaces show "بيكتب…" handwriting shimmer (not "WALKING THE GRAPH"); instant local reaction line on widget submit; scripted local opening line at lesson start; prefetch opening call from check-in.
6. **Language contract locked** (per Samuel's English-first PoC decision): English base + Egyptian Arabic coaching flavor, consistently — fix the "language lottery" (one prompt, no per-session flips). `dir="auto"` on message bubbles. Voice: keep en-US TTS; hide toggle when unusable. (Arabic-first product voice + ar-EG TTS = later ADR, per PRD.)
7. **Failure softening (prompt+card):** wrong answer → "مش مظبوطة — تعالى نشوفها مع بعض", withhold correct letter until the explanation beat lands; mastery deltas hidden from student transcript (kept as [live event] for the model); post-"still confused" check must be basic-tier or a tap widget.
8. **De-instrumentation:** per-surface debug flag (default OFF for lesson_*): hides cost/token meta rows, db ids; citation chips in lesson context read "من الكتاب ص٤٠". Founders' easter egg (triple-tap header) restores receipts. /spine keeps full instrumentation.

## Wave B2 — the whiteboard (BOARD)
1. **Persistent board ("السبورة"):** current figure + current question live in a sticky panel (desktop: chat ~58% / board ~42%; mobile: collapsible top sheet ≤40dvh). ChatCore gains `interceptWidget`; inline chip "شوف الرسمة ←" in thread; filmstrip of prior figures; dedupe repeated viz_ref by id.
2. **Controlled-step figures:** `makeAnim(on, ctrl {revealSec, animateFromSec})` in viz/core.ts + `useVizTimeline` — one seam, all 9 primitives. Lesson context: play ONCE, stretched stagger (2–4s), hold final frame (no infinite loops in transcripts; stop /gallery-style looping after 2 cycles + IntersectionObserver gating). Tap-advance "▸ التالي" + step dots on the board figure. GeoScene/ArrowMap use real `step` fields; others map n/N fractions. `{{fig_step:N}}` protocol marker = v2 after beats prove out.
3. **Focus mode:** lesson route renders without global nav (own layout), h-dvh; labeled progress stepper "٢ من ٤ · <LO label>" via existing onCite wiring + up-front promise of the report; `{{check_in}}` directive → two-big-buttons card.
4. **Check-in/picker fixes:** doors-first on mobile (picker collapses behind "درس تاني؟"); geometry unit display ref disambiguated (two "Unit 4"s today); selecting a lesson never spends an AI turn; stale "UNIT 1" footer fixed.
5. **Session persistence:** sessionStorage-level resume of lesson transcript/board (accidental nav must not destroy a session).

## Deferred (recorded, not now)
API-runtime swap with thinking disabled (kills 32s spikes; needed for deployment — pending ADR on CLI vs API for student surfaces) · Arabic-first voice + ar-EG TTS (ADR) · `{{fig_step:N}}` sync markers · RTL document pass for production PWA · `[[term?]]` terminology-review flag.

## Acceptance (spot checks)
- Spine turn ≤ $0.05; full learn lesson ≤ EGP 8 measured in ai_interactions with cache columns populated.
- A geometry learn lesson: text reveals in beats at reading pace; figure draws once on the board while its beat is being read; question appears on the board; wrong answer → soft coaching, no scoreboard; stepper advances; report card unchanged.
- No infinite animation loops in a lesson transcript; no meta/cost rows visible in lesson mode; no language flips between sessions.
