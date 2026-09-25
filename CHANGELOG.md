# Changelog

All notable changes to the **`PDR1-0`** solution (Student MVP). The frozen
baseline `family-tutor` has its own history and is not tracked here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
scheme is described in [docs/VERSIONING.md](docs/VERSIONING.md). Entries are
written for someone who does not know the codebase, and every line that closes a
requirement names it.

## [Unreleased]

v0.9.2, in progress — **not committed; awaiting Samuel's review.** The whole product reads the curriculum
in one order, lists that mix subjects keep each subject together, and the circle unit says which term it
belongs to. Student-facing (the practice plan, the
progress page, the check-in) and the internal tools; one data migration (031).

### Fixed — one curriculum order, everywhere (FR-3217)
- **The practice plan now falls back on the lesson order.** The plan picks your weakest topics first,
  and that has not changed. But when topics tie — and for a new student every topic is at zero — the
  database used to choose between them. On the local copy, a new maths student's practice opened on
  Unit 2, Unit 3 and Unit 4. It now opens on Unit 1, lesson 1, and follows the lesson list from there.
- **A list that holds more than one subject now keeps each subject together** — maths first, then
  Social Studies, then Arabic, the order the app already shows subjects in. Samuel: *"Yes they need to
  split by subject."* Before, a student who could see all three subjects got them mixed by unit number
  (Arabic, Social Studies and maths objectives alternating). This applies to the practice plan, the
  lesson picker when no subject is chosen, the progress page's list of topics not started yet, the
  `/pipeline` map and `/gallery`. A list of one subject is unchanged, and so is the order lessons
  unlock in (the progression).
- **The progress page lists the topics you have not started in lesson order:** Term 1, then Term 2,
  then geometry. Before, Term 1's Unit 1 and Term 2's Unit 1 counted as the same position, so the
  database chose which came first.
- The internal tools use the same order: the `/pipeline` map, the heatmap rows on the console
  Overview, and the unit groups on `/gallery`. On `/gallery`, Term 2's Unit 1 used to come before
  Term 1's, and the circle unit came between Units 3 and 4.
- For whoever maintains it next: every reader now takes its order from `app/src/lib/module-order.ts`,
  and a list of several subjects puts `SUBJECT_RANK` (read from the subject registry) in front of it.
  A new test fails if any query sorts by a topic's position in its unit without that order, or uses
  the order without the subject key and has not been declared a one-subject list.
- **The tutor's "Ask the Spine" context uses the same order.** Samuel lifted the hold on prompt
  changes for this ordering: *"yes for sure, for decision 2, it is part of the overall consistency."*
  The tutor sees the topics, the units and the figures in lesson order, maths first. It still
  focuses on the eight weakest topics — the only ones it gets full descriptions, question stems and
  figure captions for — but a tie now goes to the earlier topic. For a new student every topic ties,
  so her focus used to be whatever the database returned first: for a maths-only student, the first
  topic of Units 2, 3, 4 and 5, geometry and Term 2. It is now Unit 1's first eight topics.
- **The same data now always gives the tutor the same context.** Its list of prerequisite arrows
  had no fixed order, and it changed when the database happened to store the rows differently. It
  is now in lesson order: the arrows from the first topic come first. The wording of every prompt is
  unchanged, and nothing else the tutor sees changed: 12 of 438 captured prompt files differ, all of
  them the "Ask the Spine" context.

### Fixed — the circle unit names its term (FR-3218)
- **"Unit 4 — The Circle" is now "Term 2 · Unit 4 — The Circle"**, like every other Term 2 unit. It
  is Term 2 by its own syllabus reference, and the book starts it on page 39 of the Term 2 book.
- **The Arabic and Social Studies check-in no longer says a maths unit's term twice.** Its list of
  maths units showed "Term 1 · Term 2 · Unit 1" and "Term 2 · Term 2 · Unit 5".
- Existing databases get the new name through migration 031. Deploys never reload the curriculum,
  so without the migration, production would keep the old name. The migration changes this one
  label and nothing else, and a second run changes nothing.
- The tutor sees the new name in the four circle lessons and in "Ask the Spine"'s list of units. No
  other part of any prompt changes (22 of 438 captured prompts, by this name only). Samuel approved
  this on 2026-09-25 as a one-string exception to the hold on prompt changes (ADR-0020).

## [v0.9.1] — 2026-09-25

The skill map reads in lesson order again, in tidy columns. Student-facing, `/spine` only; no
migration.

### Fixed — the skill map's order (FR-3215)
- **The skill map now lists topics in the same order as the lesson list.** Topics used to be
  sorted by their position inside their own unit, and nine maths topics share each position. The
  database therefore chose the order of every tie, and could choose differently between visits: on
  production the first column read Geometry 1, Unit 2, Unit 3, Unit 1, Unit 4, Unit 3. It now reads
  Unit 1 → Unit 2 → Unit 3 → Unit 3 → Unit 4 → Geometry 1, in the catalogue order the lesson list and
  the progression already use. It is the same on every visit.
- The topic panel's "Worth having first" list follows the same order. Before, it came out in whatever
  order the database returned.

### Changed — the skill map's columns are packed again (FR-3216)
- **Each column of the skill map is again an evenly spaced stack, centred on one line the whole
  map shares**, as it was before v0.6.0. Tamer's v0.6.0 redesign placed each topic at the height
  of the topics it builds on. That kept a topic next to its prerequisites, but left long lines
  and large gaps, and the map read as scattered. Samuel preferred the ordered, list-like reading. The
  rest of Tamer's redesign is unchanged: the cards, their colours, the lines and arcs, both
  panels, and keyboard use. His reasoning for the floating columns stays in the code, marked
  as superseded.
- The first column is shorter than the tallest one, so it now sits in the middle of the map. The map
  therefore opens scrolled to show it, starting from its first topic.
- For whoever maintains it next: the map's layout moved into `app/src/lib/spine-layout.ts`, a module
  with no React and no database, and is tested on the real maths curriculum (20 new tests; 3 of them
  need a scratch database and run only when asked).

## [v0.9.0] — 2026-09-24

The turn and upload limits become numbers the console watches instead of walls a student hits, and
with probing on, asking for the answer waits for the second attempt like the card does. Explainer:
[`docs/releases/v0.9.0.html`](docs/releases/v0.9.0.html).

### Changed — turn and upload limits are now watched, not enforced (ADR-0023, FR-3401…FR-3409)
- **Noor no longer stops a conversation after a fixed number of replies.** Until now the tutor
  refused to answer past a per-surface limit and locked the input: 2 replies per question when asking
  Noor about a question, 18 in a lesson's teach-and-practice mode, 5 in a lesson's quick review mode. Samuel removed the
  limits — *"we need to know how often those limits are triggered"* — so a student can now keep a
  conversation going for as long as they need it (FR-3401).
- **A student can now upload as many photos or PDFs a day as they need.** Until now the 11th upload
  in a day was refused. Samuel removed this one too, the same day — *"please remove the limit of the
  photo uploads for now as well"* — on the same terms: only the daily count is gone. The 10 MB size
  limit and the JPEG/PNG/PDF type limit are unchanged; neither one counts uploads (FR-3407).
- **Worst-case spend per conversation, and per student's uploads, is now unbounded**, and both are
  watched in the console instead of being capped on the server. The numbers above are unchanged and
  still mean something — they are now *observed thresholds* rather than a hard stop.

### Added
- **The console's Cost page gets a "Turn limits — observed, not enforced" panel**: for the period
  you're looking at, and per surface, it shows how many conversations there were, how many reached
  their threshold (and what share that is), how many went further still, and the longest conversation
  seen — highlighted whenever any conversation reached a threshold in that period. It also lists the
  most recent conversations that reached a threshold, each linked to its session (FR-3403, FR-3404).
- **The Cost page also gets photo-upload monitoring**: uploads in the period, the students who
  uploaded, how each was parsed, and upload/OCR spend with its average per upload — kept separate
  from tutoring spend, as it already was. It shows how many student-days reached or went past the old
  daily limit, highlighted whenever any did, with a list of those student-days (FR-3409).
- **A session that reached its threshold is flagged** — in amber, never red — on the student's session
  list, on its timeline, and in its replay, so an operator can see it without opening the Cost page
  first (FR-3405).

### Removed
- The three "you've reached the limit" messages a student could see mid-conversation, and the input
  lock that came with them.
- The "that's 10 uploads today" message and the upload lock.

Requirements: FR-3401…FR-3409 in `specs/002-identity-and-admin-console/spec.md`, superseding the
baseline's FR-051 and the cap clause of 001's `T047`. Record:
[ADR-0023](docs/decisions/0023-turn-limits-observed-not-enforced.md).

### Changed — Socratic probing: asking for the answer no longer skips a step (ADR-0021, FR-3112)
- **While probing is on, asking the tutor for the answer no longer gets it early.** The card already
  waited for a student's second wrong attempt before showing the answer; the tutor's own words did
  not — asking "just tell me" could get it after only one. Samuel: *"it should be 2 questions as
  well."* Both now agree: nothing — not asking, not the tutor's own judgement — reveals it before the
  second wrong attempt on that objective. This applies only while a sitting is probing, which in
  production today means test accounts only.

Requirements: FR-3112 in `specs/002-identity-and-admin-console/spec.md`. Record:
[ADR-0021](docs/decisions/0021-runtime-teaching-toggle-and-testers.md#amendment-2026-09-24--reveal-threshold).

## [v0.8.0] — 2026-09-24

Console sign-in from the email Cloudflare Access has already verified. A security review read it
before release and its findings are fixed below, except one decision left to Samuel. No database
migration. Explainer: [`docs/releases/v0.8.0.html`](docs/releases/v0.8.0.html).

### Added — console sign-in from Cloudflare Access (ADR-0022, FR-3301…FR-3312)
- **Operators are signed in to the console from the email Cloudflare Access has already
  verified** — no password, no form. The console checks Cloudflare's signed token (signature,
  issuer, the admin-noor application, expiry), never the plain email header, and matches the
  address to an active operator ignoring case. It fails closed: anything it cannot verify signs
  nobody in and falls back to the password form. Recorded as *Operator signed in* with reason
  `cloudflare-access:<roles>`.
- **A Cloudflare identity with no console account is refused** with a page that says exactly that,
  and the refusal is recorded with the address. If the browser held another operator's console
  session, that session is ended — the person Cloudflare proved wins.
- **Signing out of the console also signs you out of Cloudflare Access** — through the console's own
  `/cdn-cgi/access/logout` — so the next visit asks for a new PIN instead of silently signing you
  back in.
- **Locally, "Sign in as <operator>"** on the console's sign-in page, only when all three hold: not a
  production build, `AINEXT_DEV_OPERATOR_PICKER=on` (written by `local-dev.sh`), and a request to
  this machine — which `local-dev.sh` and `.claude/launch.json` make true by starting the console on
  `127.0.0.1` only while the flag is set. The endpoint is not compiled into any production build,
  and `check:surface:admin` fails if it ever is.

### Security — a review of this feature, fixed before release (ADR-0022 *Amended*)
- **Dev picker:** the console dev server listens on `127.0.0.1` whenever the picker is set (before,
  anyone on the same Wi-Fi could forge `Host: localhost` and be any operator); `Origin: null` is
  refused.
- **Sign-out** goes to the console's own Access logout, not the team-wide one, which left the
  console's Access cookie valid for 20–30 s — long enough to be signed straight back in.
- **Only a top-level navigation** starts a Cloudflare sign-in; an image, frame or prefetch planted by
  another site gets `403`.
- **Proven addresses must be plain ASCII** and are compared by one rule everywhere, closing a
  redirect loop two lower-casing rules could cause.
- **The per-request identity check waits at most a second**, so a hung Cloudflare key endpoint
  cannot stall every console page; the key cache is kept for an hour.
- **Refused assertions are recorded within a budget** (20 per address, 200 in total per 15 minutes)
  so the security record cannot be flooded; the Security view's note on the reason column is
  corrected.
- **CI rejects a malformed team domain or AUD** instead of deploying with the feature silently off.
- **Open, for Samuel:** the console is reachable without Cloudflare from the shared mail network —
  options and a recommendation in ADR-0022; Access dashboard settings to confirm in
  `deploy/TAKEOVER.md` §9.4.

### Changed
- **Password sign-in on the console is now the fallback**, shown when Cloudflare's identity is
  absent or cannot be verified (contracts/auth.md §Operator authentication, amended).
- **Deploy:** `AINEXT_CF_ACCESS_TEAM_DOMAIN` and `AINEXT_CF_ACCESS_AUD` on the console service,
  written by CI from repository variables (not secrets) with the production values as defaults;
  `off` switches the feature off. Post-deploy checks: `deploy/TAKEOVER.md` §9.

## [v0.7.0] — 2026-09-24

The teaching switch, test accounts, and a record of which version and which teaching mode served
every lesson. Two independent reviews and a code review read it before merge. Explainer:
[`docs/releases/v0.7.0.html`](docs/releases/v0.7.0.html).

### Security
- **A sign-in link can no longer send someone to another website** (FR-2015). The `?next=` address
  after sign-in accepted look-alike paths (a tab character, or dot segments such as `/.//site`)
  that a browser turns into a different site. That affected the live student site too, and on the
  console could have been used to stage a fake "enter your code" page. The address is now checked
  after the browser's own rules are applied, and must stay on the same site.

### Added — the teaching switch (ADR-0021, FR-3101…FR-3111)
- **Socratic probing can now be switched on from the console, for test accounts only.** A new
  **Teaching** page offers three positions: **Off** (the default), **Test accounts only**, and
  **Everyone** — which is shown but locked, with "Not ready yet — see issue #53", and the server
  refuses it. Probing only ever applies to maths lessons in learn mode; Social Studies, Arabic,
  review mode and practice never probe, because none of its wording is translated.
- **Test accounts.** An operator holding both the student-data and the teaching-controls roles
  marks a student as a test account from the student's page — "only accounts the team owns, never
  a real student" — and removes the mark with one click. Who marked it, who removed it and when are
  kept, and a removed mark can never be reopened or rewritten.
- **A new operator role, `teaching-controls`**, is the only one that can move the switch — split
  out of content review so it can be narrowed later. Every active operator who held content review
  got it once; a later deploy never gives it back to someone it was removed from — not even after
  the role is withdrawn and re-added.
- **Off applies to a student's next message; On from their next sitting.** Whether a sitting may
  probe is decided by the server when it starts and written down with it. Switching Off — or
  removing a student's test-account mark — stops probing on that student's very next message, even
  mid-lesson, and a question card that was holding its answer back shows it. Switching On never
  changes a sitting already under way. The tutor, the question cards and the saved answers all
  follow the server's answer for each message — never anything the student's device sends.
- **You can see what each sitting got.** Every sitting now records which release served it and
  whether probing was on when it started. The console header shows the deployed release and the
  switch on every page ("unknown" if it cannot be read, instead of an error page); the Teaching
  page shows who changed it, when, and every change since, to any operator holding a role; a
  student's session list, timeline and replay show both per sitting.

### Changed
- **With probing Off, the tutor's instructions are unchanged, character for character.** All 24
  tutor prompts (three subjects × four ways of addressing a student) were compared with a copy taken
  before any of this was written, and the reviews compared all 438 captured model inputs: identical.
  The question cards and the saved answers take the same code paths as before. Two things did
  change for everyone: the tutor's reply stream starts with one extra (invisible) frame saying
  whether probing is on, and each sitting's record gains the release and the probing decision.
- **The release name is the deployed build's.** Turns and lessons are stamped with the tag the
  deploy computes (or `v<version>` on a laptop), no longer the old `PDR1-0-v…` package name that two
  builds could share.

### Also in this release
- **Once a lesson stops probing, it never starts again.** Switching Off, or removing a tester mark,
  reaches the student's next message; switching back On only affects lessons that start afterwards
  (FR-3105).
- **Requirements written for what v0.6.0 shipped without them** (FR-3201…FR-3214): lesson
  progression, the `/spine` skill map, "students never see review status", the per-subject Content
  page, re-runnable migrations and the misconception sync, each with an honest status.

### Operations — rolling back, and proving it before every deploy
- **Rolling back is written down**: [`deploy/DEPLOY-MVP1.md` → "Rolling back"](deploy/DEPLOY-MVP1.md#rolling-back).
  A feature problem is the Teaching switch set to Off — no deploy. A code problem is a reverted
  merge and a deploy, safe from v0.6.1 on. **Never redeploy v0.6.0 itself after this release**: its
  migration 014 re-adds a four-role rule the database refuses once anyone holds the new role, and the
  site stays down; the runbook has the manual path if it is ever unavoidable.
- **This release's migration 014 carries the same guard as v0.6.1**, with the fifth role, so this
  release is a safe place to roll back to later.
- **CI now proves the migrations** on every change to `db/`: three times onto an empty database, as
  an upgrade from the previous release, and as a rollback onto it and forward again (job
  `migrations`). A deploy now waits for it.
- **The app and console logs rotate** (5 × 10 MB each) — the shared box's disk no longer grows with
  every lesson opened.

## [v0.6.1] — 2026-09-24

A safety release with nothing visible to students or operators. It makes going back from v0.7.0
safe.

### Fixed
- **Migration 014 no longer rebuilds the operator-roles rule on every deploy.** Every deploy
  re-applies every migration. 014 dropped and re-added its four-role list unconditionally, so once
  v0.7.0 adds a fifth role (`teaching-controls`), deploying this line of code again would fail the
  migrate step and leave the site down, the same failure as 008 on 2026-09-23. 014 now rebuilds the
  rule only when it lacks one of its own roles, so a wider rule from a later release is left alone.
  Tested on scratch databases: fresh (built, then left alone), a copy of real data (left alone),
  v0.7.0 on top, then this release re-applied twice over the v0.7.0 database (passes; the
  `teaching-controls` rows survive). Deploy this before v0.7.0. Part of the migration re-run
  requirement recorded with v0.7.0 (FR-3213).

## [v0.6.0] — 2026-09-23

A deep-reviewed release. It brings Tamer's work onto `main` and carries the day's fixes. Four
independent reviews (student flows, database and privacy, design and copy, Socratic probing)
read every change before merge, and each finding was fixed and re-tested. Explainer:
[`docs/releases/v0.6.0.html`](docs/releases/v0.6.0.html).

### Added — Tamer's work, brought onto `main`
- **"How you're doing" skill map on `/spine`.** A student-facing map of every topic, with a
  simple fill and one plain word per topic in place of percentages and internal ids. Noor sits
  in a side panel beside it, and becomes a bottom sheet on iPad portrait.
- **A new "Up next" card for each subject.** It reads top to bottom: topic, how far along, the
  one shaky part, then two actions ("Walk me through it" / "Quick review"). It says which
  objectives a lesson has not asked about yet, and keeps a "Revisit" row for the lesson just
  finished.
- **Lessons move on when they are mastered** (ADR-0020). Each student has a saved place in each
  course, and it advances to the next lesson once every objective in the current one is
  mastered. Everyone starts at lesson 1; no existing progress was guessed at.
- Maths lessons now run Term 1 before Term 2 (they were interleaved).
- A wrong answer with no diagnosed mistake now shows the worked solution, instead of an
  unrelated mistake's explanation. Explanation steps render maths properly.
- **Socratic probing is in the code, switched OFF** (`SOCRATIC_PROBING_ENABLED`). Students get
  exactly today's behaviour; the review proved every tutor prompt byte-identical. What must be
  fixed before it is switched on is listed in #53.

### Changed
- **Everyone sees Play for now.** Master — the calmer look meant for Secondary students — is
  hidden behind one switch (`MASTER_VARIANT_ENABLED`), because it was showing the old family-tutor
  look under Master's name with Play's buttons on top. Students and the console both get Play; the
  appearance setting shows a single line instead of a choice. Saved choices are kept, so Master
  comes back with one change once it is really built (ADR-0017 amendment; FR-1011 PARTIAL;
  review `docs/reviews/2026-09-23-play-master-ui-review.md`, issues #46–#51).

- **The whole maths bank is live on noor.reletix.com.** The site had only the textbook's questions:
  none of the 543 generated questions, 49 widget questions or 96 misconceptions your laptop has.
  The first deploy never loaded them. Samuel changed the rule that kept unreviewed generated
  content behind an invite-only gate (constitution v3.2.0, ADR-0019; FR-907 dropped). The next
  deploy loads them once, and the 29 maths book questions still waiting go live too. Review status
  is kept in the data and shown in the console only; nothing is marked as reviewed that was not.
  Student screens no longer say content is "reviewed". Arabic scripture held by the sacred-content
  gate stays held.

### Fixed
- **The site went down for about 15 minutes during a deploy, and cannot again the same way.**
  An old migration re-ran on every deploy and rebuilt a rule without the "widget" question type;
  once widget questions existed it failed and the app never started. It now leaves a wider rule
  alone. The new migrations (027, 028) are proven to re-run cleanly and take no locks.
- The subject home's English copy no longer leaks another subject's labels (#41 pattern).
- **Every maths misconception now has an explanation, and one question's wrong answers point
  at the right mistakes.** An empty duplicate ("points on an axis counted inside a quadrant") is
  folded into the full entry, and "a divides b read as b divides a" gets its explanation. The
  graphical-solution question `q:t2u1-2-1:g002` tagged two wrong answers with a mistake from the
  next lesson; they now name two new mistakes of their own lesson. The catalogue is re-synced on
  every deploy, so fixes like this reach the site without a manual refresh.
- **The console's Content page says which subject it is counting.** Its "From the book" figure
  added all three books together without saying so (914 = 421 maths + 483 Social Studies + 10
  Arabic), and the questions held at review appeared nowhere. It now has a subject switcher, a
  "held" tile, and a subject column.
- **Console in Play:** small buttons and labels no longer carry the thick 3px outline, tables
  are set tighter in the reading face, empty heatmap cells read as empty instead of darkest, and
  the "Confirmed" badge is readable (it was 2.7:1).
- **Student screens in Play:** subject colours show on the home cards again. The report card,
  check-in and feedback prompt use one sticker look instead of three. No red anywhere: wrong
  answers are grey, mastery uses one amber-to-teal scale on every screen. Chat messages are
  readable size, and the bubble tail is back and flips in Arabic. Headings no longer collide.
  Keyboard focus is visible on sticker controls.
- Fewer font files preloaded on every page (the old family-tutor faces are no longer preloaded).
- `app/.env.example` now sets `AINEXT_ENVIRONMENT`, so a fresh checkout renders a skin at all.

## [v0.5.0] — 2026-09-22

**The tag is bare from here.** Releases up to `PDR1-0-v0.4.0` carried the branch
name as a prefix, because two solutions were live and versioned independently.
`PDR1-0` was retired on 2026-09-22 when `main` became the single development
branch, so the prefix now names something nobody can push to. **This release is
the direct continuation of `PDR1-0-v0.4.0`** — the older tags keep their names
and their commits; only the naming rule changed (`docs/VERSIONING.md`).

Feature 002 — identity, per-student isolation and the admin console — built in seven
phases on `feat/002-identity-and-admin-console`, plus an evening of work on 2026-09-21
that added course availability, reachable uploads and the two skins. Merged to `main`
and tagged `v0.5.0` on 2026-09-22 (PRs #44 and #43). **Not deployed**: the deploy job
is `workflow_dispatch` only and the box still needs its setup
(`deploy/TAKEOVER.md`, `specs/002-identity-and-admin-console/SETUP.md`).

Until this ships, "which student is using the product" was answered by a dropdown.
That is the thing that changes.

### Added

- **Real accounts, and the end of the picker.** A student signs up with an email
  address and a password, confirms the address, and signs in. Before this there was
  a menu of demo students and anyone could pick any of them; there was no such thing
  as *your* data. Sign-up asks for name, grade, and optionally how the tutor should
  address her and what she is interested in. Sessions are two cookies no page script
  can read, the short one expiring in fifteen minutes and the long one rotating on
  every use — and if an old one is ever replayed, every session on that account is
  ended, because a replayed credential means somebody has a copy. Five wrong
  passwords lock the account for fifteen minutes. Reset works by email and says the
  same thing whether or not the address exists. `FR-2001`…`FR-2012`, `FR-2014`.
- **Per-student isolation enforced by the database, not by remembering to filter.**
  Twenty tables now carry row-level security policies, and the application connects
  as a role that cannot bypass them. A query that forgets to say which student it is
  about returns **nothing** rather than everything — which is the opposite of the
  usual failure, and the point. Asking for another student's record answers "not
  found", byte for byte identical to asking for a record that was never there.
  `FR-2101`…`FR-2109`.
- **An admin console, as a separate build of the same codebase.** The pipeline, the
  content review queue, the gallery and the dev harnesses no longer live in the
  student's app at all — they are compiled into a second build that runs on its own
  port. Four roles decide who sees what: content review, evidence access, student
  data, cost and billing. An operator holding only one of them is refused the rest,
  and the refusal is recorded. `FR-2201`…`FR-2211`.
- **A real record of what a learning session was.** The `sessions` table had existed
  for months and had never held a single row, so a tutor turn could only be tied to
  the lesson it belonged to by guessing from timestamps. Sessions now open, close on
  completion or after thirty minutes of silence, and every turn, answer, check and
  upload is attached to one. `FR-2301`, `FR-2302`, `FR-2309`.
- **Student 360, one timeline, and a replay.** An operator can open a student's
  record and see the whole of it in one place — mastery over time, attempts, time on
  task, help-seeking, misconceptions, cost — and then open any past session as a
  single ordered story: what the tutor said, what she answered, which widgets she
  used, when the mastery moved. A replay renders it in the student's own screens,
  made read-only, labelled "Reconstructed from stored records" and stamped with the
  version that drew it, so a replay that no longer matches what she actually saw can
  be recognised rather than believed. `FR-2303`…`FR-2305`.
- **Every operator read of a student's record is logged**, with who and when, shown
  to the next operator who opens that record. Operators can add to that log and
  cannot remove from it. `FR-2306`.
- **Cost per student, over time, honestly labelled.** AI spend and photo/OCR spend
  are reported as two figures and never blended; per-student figures reconcile
  against the period total and say so on the page; every number says "imputed at
  list price" because that is what it is. `FR-2401`…`FR-2403`, `FR-2407`.
- **Subscription status per student — a record, never a gate.** Only the cost and
  billing role can set it, every change records who and when, and a test scans the
  student-facing screens to prove nothing there reads it. No student is ever shown a
  door that is locked. `FR-2404`…`FR-2406`.
- **A security view, and alerts.** Sign-ins and failures over time, accounts locked
  right now and why, top source addresses, live sessions, refusals by operator, and
  a cross-student-access counter whose acceptable value is zero. A sweep evaluates
  four alert rules plus a fifth that only ever reports. `FR-2502`.
- **Cohort overviews and a dictionary.** How a subject and grade are doing by
  school-year week, an objective-by-week heatmap that shows "never reached"
  differently from "reached and failing", and a definitions page every query cites by
  name — so two people reading the same number mean the same thing by it.
  `FR-2507`.
- **The tutor addresses each student correctly.** She says how she would like to be
  spoken to at sign-up, or declines; the tutor's language follows on the next turn,
  with no sign-out. `FR-2601`…`FR-2603`, `FR-2606`.
- **Who may see which course, decided in the console.** All three subjects now appear on
  a Courses page — the product as it will be sold — with a switch per subject per school
  year deciding which of them actually reach a student, and an exception for one named
  student that overrules the year in either direction. **A course is hidden until
  somebody says otherwise**: no rule means no access, so a book loaded overnight cannot
  be on a fourteen-year-old's screen before a person decided it should be. Deciding a
  year's rule and deciding one student's access need different permissions, so the person
  who manages subjects never learns a child's name through it. Every decision records who
  made it, when, and why in their own words. `FR-2701`…`FR-2711`,
  [ADR-0018](docs/decisions/0018-course-availability.md).
- **A student can finally send a photograph of her homework.** The server has accepted
  and read photographs for weeks; nothing in the product could send one, and the
  connection between an uploaded worksheet and the tutor's next answer had never once
  been made. Both halves are fixed: one attachment control in the message box that both
  the lesson and the chat show, a camera on touch devices, and the photograph actually
  reaching the tutor — who now quotes the equation off the page and declines to solve it,
  which is the rule we always claimed and had never been in a position to apply.
  `FR-205`, `FR-206`, and the upload half of `SC-009`.
- **Two skins, chosen before the page paints.** Play for preparatory years, Master for
  secondary, decided on the server from the student's school year and settled before the
  first pixel — no flip half a second in. A student who prefers the other one says so in
  settings and it follows her to any device, because it is stored with her account rather
  than in the browser. Operators get the same control for the console.
  `FR-1011`, [ADR-0017](docs/decisions/0017-two-variants-keyed-to-grade.md).
- **Arabic and Social Studies are back in the app.** They were never dropped: the
  bundles, the teaching voices and the loader's support for all three had been in the
  tree the whole time, and one line of a local setup script loaded maths and nothing
  else. Now loaded — social studies 84 objectives, arabic 100 — and **loading is not
  showing**: each one stays invisible until somebody sets it live for a year.
- **The security record can be explored instead of scrolled.** Filter by what happened,
  to whom, by which operator, with what outcome, over which window; page through it; see
  a true total instead of an arbitrary cut at two hundred. Every view is an address an
  operator can paste into an incident. Sign-in history is the same list in a different
  mode. A student's record now links straight to who has read it and how she has signed
  in. `FR-2502`, `FR-2306`.

### Fixed

- **The tutor assumed every student was a boy.** Not as a default that could be
  changed — there was no setting. Close to a hundred masculine forms across the
  lesson, chat, check-in, widget-documentation and grader prompts (63 in the lesson
  prompt alone, and three files nobody had counted), and the text that read as
  "neutral" was simply the
  masculine register, served to girls. All of it now comes from one place, with a
  form that is correct for either when she has not said. `FR-2605`.
- **All fourteen interactive widgets told the tutor the student was called "Omar"** —
  the name of a retired demo student — whichever student was actually using them, and
  one of them used a masculine pronoun.
- **Every photo/OCR row in the cost ledger had been written as zero**, so the upload
  figure we report separately was structurally zero and always had been. It reads the
  parser's real usage now.
- **Turns killed by the content guard also cost nothing, on paper.** They cost real
  money; the guard just stops the process before the cost is written down. They are
  priced at list price now and marked redacted, and a failed or redacted turn no
  longer eats into a student's turn allowance.
- **The input-token count included the cache counters**, which over-stated it
  everywhere it appeared.
- **A finished session could be recorded as having ended before it began**, when the
  inactivity timeout stamped it with the last time it was seen.
- **The tool that proves a prompt did not change had been broken**, so every change
  for weeks could only report that it "fails the same way it did before". It works
  again, and now covers two prompts it had never been able to reach.
- **A button that did nothing and said nothing about why.** Clicking "Live" on an empty
  course asked for confirmation with the browser's own dialog box — and Samuel's browser
  had dialogs switched off, which makes that question answer itself with "no". Every
  embedded preview, kiosk and corporate policy that suppresses dialogs does the same. The
  question is part of the page now, and no screen in the product uses a browser dialog
  for anything.
- **The cohort overview had quietly become Arabic's.** Loading two more subjects made the
  page default to whichever sorted first alphabetically, while still reading as though it
  described the product. It now defaults to the busiest cohort, names its subject in its
  own heading, and offers a control instead of links you had to spot.
- **The cost tile showed a dash and did not say why.** It holds only days that have
  closed, and every interaction on record happened today. It now says which of three
  empty states it is in, and names today's figure without pretending it is part of the
  stored series.
- **Two console pages had never been added to the routing rule** the other twelve pass
  through, since the day they shipped. And the local environment-file reader mis-read a
  line break written as `\n`.

### Security

- **The application had been connecting to the database as a superuser**, in both
  places it runs. A superuser ignores row-level security completely, so the whole
  isolation scheme would have been decoration. It now connects as an ordinary role
  that the policies actually apply to, and the proof is run as that role — run as a
  superuser it passes for the wrong reason.
- **The console accepted a student's credential**, because browsers share cookies
  across ports on localhost. Each surface now has its own cookie names, and a token
  from the wrong surface is refused, recorded, and left untouched rather than
  destroyed.
- **Two places leaked other students' data and are gone**: an endpoint that returned
  every student's name, grade and interests to anyone who asked, and a panel on the
  pipeline page that displayed the most recent tutor conversation written by *any*
  student.
- **Operator passwords are never written into a configuration file.** The first
  operator is created without one and obtains it through the ordinary reset flow,
  and reset links are built from a configured address rather than from whatever host
  the request claimed to be for.
- **Three ways to reach a subject you were not given.** Found while building the course
  switch, and none of them was reachable while only one subject existed — all three go
  live the moment a second one does, which is now. An answer-checking endpoint graded
  *any* question in the database and handed back the correct answer with the full worked
  solution; the curriculum explorer shipped every question in every subject, answers and
  solutions included; and practice mode served questions from subjects a student could not
  open. All three are closed by the same rule, applied where the data is read rather than
  where it is displayed.
- **A local convenience nearly published scripture nobody had read.** The setup script
  promotes questions to live so the local database is usable. It selected by how a
  question was authored, which meant "the maths book" only because maths was the only
  book. With Arabic loaded it would have promoted 576 held questions — 297 of them Quran
  and hadith passages held for a named religious-content owner to check against a printed
  source — and stamped them as reviewed by a script. It names the subject it was always
  about now. Verified: it promotes none of them, and all 576 stay held.

### Requirements and records

- **Eleven requirements were written for work that had already shipped**, on Samuel's
  explicit instruction, and every one of them is stamped with the date it was written
  rather than the date of the code it describes. Course availability had deliberately
  gone out with no requirement and no traceability row, because inventing one unasked is
  how a requirements record stops being worth reading. `FR-2701`…`FR-2711`.
- **A contradiction the matrix had been carrying for six days is settled.** `FR-205` said
  uploads worked and were verified; `SC-009`, eleven rows later, said uploads were
  unreachable and the link to the tutor was dead. The second one was right. The row now
  carries that history — when it was verified in error, what the error was (code that
  existed, rather than a path a student could walk) and what closed it — instead of being
  quietly flipped to true.
- **`FR-905` — "no Arabic or Social Studies in this environment" — is recorded as unmet**
  rather than rewritten. All three subjects are loaded and live for year 9 on Samuel's own
  instruction. Reinstating it is one action per subject in the console and unloads
  nothing; whether to reinstate it or withdraw it is his call.
- **`FR-1011` (the two skins) is recorded as partial, not done.** The mechanism works and
  was driven live. Master itself is a colour name over the baseline tokens — its
  component guidelines, type scale and motion spec are unpublished — so ADR-0017's rule
  stands: **no secondary-year students should be onboarded yet**.

### Known gaps

- **Nothing here is deployed.** The console has no hostname and no Cloudflare Access
  policy yet.
- **Google sign-in is built and switched off**, and **no email has ever actually been
  sent** — both wait on credentials. Locally, every link is written to a folder.
- **Analytics is built and inert**: with no measurement id configured, no script
  loads on any screen.
- **A student cannot yet edit her own profile, or see where she is signed in** — the
  endpoints exist, the screens do not.
- **There is no way to delete an account**, and the retention decision that would say
  what "delete" means has not been made.
- **The Arabic prompts still carry masculine forms outside direct address.** Out of
  scope for a maths-only build, and named so it is not forgotten.
- **The course switch's undo has never been used.** Turning the whole thing off is one
  setting and a script, promised before the feature was built and not once exercised.
- **Half of the course switch's enforcement points have no test asserting they are
  called.** The rule itself is heavily tested; whether the curriculum explorer, the
  practice plan and the tutor's data block actually ask it is not, which is precisely the
  failure `FR-205` above records.
- **Nobody can re-run the evening of 2026-09-21.** Every earlier phase closed with a smoke
  script anyone can run again; this work was proved by hand in a browser and a database
  console. The evidence is real and there is nothing to re-run it with.
- **Seventy-eight tests prove requirements and declare none of them**, because the files
  were written when the requirements did not exist. Until a comment lands in each, the
  generated "requirements a test declares" count under-reports.
- Full status, row by row, with what proves each one:
  `specs/002-identity-and-admin-console/traceability.md` and
  `specs/001-student-mvp1-delta/traceability.md`.

## [PDR1-0-v0.4.0] — 2026-09-20

The fix pass. Ten of the 27 issues still open after v0.3.0 are closed with code;
the other fifteen carry a written answer. Two pieces of this release have **no
requirement covering them** — see *Governance* below.

**Prepared, not deployed**, same as v0.3.0.

### Fixed

- **The lesson showed a student her mastery as a percentage after every answer**
  ([#17](https://github.com/samtoma/AI.NEXT/issues/17)). Replayed through the
  real model, the reported `30 → 69 → 30` is reproduced **exactly** and is
  correct: with a 20% guess rate and a 10% slip rate, two answers genuinely move
  the belief that far. The defect was rendering it. `MasteryDelta` printed
  `mastery 30% → 69%` on `/student`, ungated, after every attempt. It now reads
  `attempted → proficient`, or `still attempted` when the band holds.
- **The tutor was being handed the same numbers, and read them out**
  ([#27](https://github.com/samtoma/AI.NEXT/issues/27)). Four places put raw
  P(L) percentages into the prompt — `mastery today 92%` in the objective lines
  is the literal source of "92%, that's excellent". All four now pass the named
  band, with an explicit do-not-quote instruction copied from the engagement
  block, which has had one since `FR-207`.
- **The student build no longer carries the internal tools**
  ([#10](https://github.com/samtoma/AI.NEXT/issues/10),
  [#11](https://github.com/samtoma/AI.NEXT/issues/11),
  [#12](https://github.com/samtoma/AI.NEXT/issues/12)). "Evidence Walk",
  "Content" and "Pipeline" sat beside "Study" in a fourteen-year-old's
  navigation. The tabs are gone and `/pipeline`, `/gallery`, `/admin/*` and
  `/dev/*` return 404, so guessing the URL doesn't work either. `/spine` stays
  reachable — the lesson report sends students there on purpose.
- **The tutor explained the question before asking it**
  ([#33](https://github.com/samtoma/AI.NEXT/issues/33),
  [#34](https://github.com/samtoma/AI.NEXT/issues/34),
  [#35](https://github.com/samtoma/AI.NEXT/issues/35),
  [#24](https://github.com/samtoma/AI.NEXT/issues/24),
  [#23](https://github.com/samtoma/AI.NEXT/issues/23)). Five reports, one cause:
  every tool the protocol gave the tutor for making a student *do* something
  produced a **card**. There was no way to express an open question — in the
  maths and social protocols. The Arabic one has had that instruction all
  along; it was written once and reached one of three subjects.
- **The lesson report had no door back into the work**
  ([#29](https://github.com/samtoma/AI.NEXT/issues/29)). It ends by showing a
  student her gaps and offered two ways out, neither of which addressed them.
  A third goes to the plan loop, which is already built weakest-first.
- **The tutor could drift back to a question the student had moved past**
  ([#22](https://github.com/samtoma/AI.NEXT/issues/22)) — the whole question
  bank is in its context and nothing said which one was current.

### Added

- **`/admin/cost` — what the AI spends, by the function that spent it**
  ([#39](https://github.com/samtoma/AI.NEXT/issues/39)). The instrumentation was
  never missing; nothing read it. Grouped by function, by teaching-versus-upload,
  and per student with a projected month — the only basis a price can be built
  on. Scoped to one environment, because a blended cost figure is a plausible
  wrong number someone would price against.

### Changed

- **The `lesson_learn` turn cap, 14 → 18.** Asking before explaining and ending
  on retrieval cost turns. At 14 a full lesson hit the cap *before* the
  retrieval, so the fix for #34 would have been skipped on exactly the lessons
  that ran long. ~29% more turns on the most expensive surface, deliberately.
- **The lesson ends on retrieval**, as its own message, from memory, before any
  recap. The arc previously read `→ closing recap message`.

### Governance

- **Two shipped things have no requirement.** Access gating and the Socratic
  protocol are both live and neither appears in `spec.md`, so neither can carry
  a traceability row without becoming an orphan CI rejects. Named in §9 of the
  matrix with Samuel as owner rather than papered over with invented FRs.
- **Nothing in the build can judge teaching behaviour.** The Socratic change,
  the Arabic/English mixing in #20 and #22's drift are all assessable only by a
  human reading a transcript. The LLM-judge harness asked for on feedback row
  015 still does not exist, so every teaching change ships unverifiable.
- **The tutor prompts assume the student is male** — 23 masculine pronouns in
  `lib/lesson.ts` alone, and no gender column in `students`. Found in review,
  on nobody's list.

### Known gaps

Fifteen issues remain open with a written answer rather than a fix. The
accounts bundle ([#8](https://github.com/samtoma/AI.NEXT/issues/8)) blocks four
of them, and two more wait on a decision from Samuel:
[#15](https://github.com/samtoma/AI.NEXT/issues/15) (whether `/spine` stays a
student surface at all) and
[#36](https://github.com/samtoma/AI.NEXT/issues/36) (how much grounding a
student should see).

## [PDR1-0-v0.3.0] — 2026-09-20

The first release shaped by someone using the product rather than building it.
Tamer ran the v0.2.0 build as a student would and filed 37 issues; this closes
ten of them, and four requirements that said VERIFIED turned out not to be.

**Prepared, not deployed.** Deploy is manual-only while infrastructure is parked
(`T139`), so tagging this does not put it in front of anyone.

### Fixed

- **A wrong answer could be marked wrong for being right.** Numeric grading used
  `parseFloat`, which reads only the leading digits, so a student who typed the
  working — `3x6` for an answer of 18 — was compared as **3**. Grading now
  evaluates the expression first, with a hand-written parser over a whitelisted
  character set (no `eval`, no model call). Still arithmetic only: `x=5` for `5`
  is not covered (`FR-C03`, [#40](https://github.com/samtoma/AI.NEXT/issues/40)).
- **Tapping "Got it" could skip a question that was never answered.** The server
  was never fooled — that acknowledgement never reaches grading at all. It is
  sent as an ordinary chat turn, and nothing stopped the *model* treating it as
  licence to move on. The chat now works out from the transcript whether a
  pushed question is still unanswered and stops the tap before it reaches the
  network (`FR-1214`, [#31](https://github.com/samtoma/AI.NEXT/issues/31)).
- **The last explanation of a lesson was taken away before it could be read.**
  Three separate timers each jumped to the report 2.2–2.5 seconds after the
  closing recap rendered, with no student action in between. The report is now
  reachable only by tapping Finish (`FR-1218`,
  [#28](https://github.com/samtoma/AI.NEXT/issues/28)).
- **Every learn session opened by telling the student they understood nothing.**
  Two independent copies of that premise — one in the tutor's system prompt, one
  in a hidden message sent as if the student had typed it — fired even for a
  lesson never attempted. Both now key off the same mastery banding the progress
  ramp uses, so a first lesson opens as something new (`FR-1009`,
  [#30](https://github.com/samtoma/AI.NEXT/issues/30)).
- **Arabic was rendering to English-subject students in about thirteen places.**
  The cause was structural: `debug` and mode flags were standing in for a
  language check, so instrumentation state decided which language a child read.
  Language is now its own prop, defaulting to English (`FR-208`,
  [#20](https://github.com/samtoma/AI.NEXT/issues/20),
  [#41](https://github.com/samtoma/AI.NEXT/issues/41)).
- **"brafo", "brofa" and friends** were not a typo anywhere. The maths language
  contract instructed the model to sprinkle transliterated Egyptian-Arabic
  interjections into English replies, and its own inconsistent transliteration
  of برافو is where they came from. The instruction is gone from the English
  maths contract only; the Arabic subject contracts keep theirs
  ([#26](https://github.com/samtoma/AI.NEXT/issues/26)).
- **The tutor talked about the student instead of to them** — fixed in the
  system prompt ([#16](https://github.com/samtoma/AI.NEXT/issues/16)). The
  check-in button that read "I'm lost", with an Arabic gloss beside it in
  English mode, now reads "Walk me through it"
  ([#19](https://github.com/samtoma/AI.NEXT/issues/19)).
- **A widget question printed its own stem twice** — once typeset by the card
  and again as raw LaTeX inside the widget — under a Submit button that could
  never enable, because a widget has nothing to submit (`ADR-0009`). Found in
  review of that fix: hiding the button row took the card's only error surface
  with it, so a failed widget attempt reported nothing at all.
- **The student check-in showed mastery in colour alone.** Taking the percentage
  off the study page ([#42](https://github.com/samtoma/AI.NEXT/issues/42)) took
  every non-colour signal with it. Measured, lit segments sat 1.84:1–2.84:1
  against unlit ones — under the 3:1 floor — and adjacent bands 1.02:1 apart.
  The ramp now carries an ink outline and a named band, and still no number
  (`FR-1003`).
- **Voice is pulled from the lesson UI** ([#21](https://github.com/samtoma/AI.NEXT/issues/21)).
  The backend stays wired and dormant rather than deleted, so bringing it back
  is a flag, not a rebuild.
- **The traceability counts block had never once been generated.** `--write`
  searched for a section heading that does not exist, so the table was
  hand-maintained and had drifted five requirements and eight tasks out of date
  — and the command returned non-zero, which would have failed CI's staleness
  check on any push touching `app/`.

### Changed

- **Noor Play replaces Master as the design system** ([ADR-0011](docs/decisions/0011-noor-play-design-system.md),
  [#38](https://github.com/samtoma/AI.NEXT/issues/38)). Sticker chrome, 52px
  targets, Baloo throughout, seven named animations. The reversal had been
  sitting unconfirmed since 2026-09-16; the reason Master was originally picked
  — avoiding a second variable in a controlled comparison — no longer holds,
  because ADR-0010 withdrew parity and made the comparison observational.
  Additive: blanket radius and border rules mean plain utilities pick up the
  treatment with no component touched, and nothing was removed. The product is
  called **Noor** throughout ([#37](https://github.com/samtoma/AI.NEXT/issues/37)).
- **The tutor reads the student's actual grade** instead of a hardcoded "10".
- `FR-1003` is **clarified, not amended**: it asks for a named band, never for a
  percentage. Dropping the number was always allowed; dropping every non-colour
  signal never was.

### Known gaps

- **The Socratic cluster is untouched** — seven issues
  ([#22](https://github.com/samtoma/AI.NEXT/issues/22),
  [#23](https://github.com/samtoma/AI.NEXT/issues/23),
  [#24](https://github.com/samtoma/AI.NEXT/issues/24),
  [#32](https://github.com/samtoma/AI.NEXT/issues/32),
  [#33](https://github.com/samtoma/AI.NEXT/issues/33),
  [#34](https://github.com/samtoma/AI.NEXT/issues/34),
  [#35](https://github.com/samtoma/AI.NEXT/issues/35)) saying one thing: the
  tutor explains where it should elicit. It is the largest item in the feedback
  and the core bet (`SC-005`), and it is not in this release.
- **The internal surfaces are ungated.** `/pipeline`, `/gallery`, `/spine`,
  `/admin` and `/dev` have no environment check and no auth, and the front page
  links to two of them ([#10](https://github.com/samtoma/AI.NEXT/issues/10),
  [#11](https://github.com/samtoma/AI.NEXT/issues/11),
  [#12](https://github.com/samtoma/AI.NEXT/issues/12)). Cloudflare Access is the
  only thing holding them.
- **The tutor prompts assume the student is male** — 23 masculine pronouns in
  `lib/lesson.ts` alone, more in `lib/ask.ts` and `lib/checkin.ts`, and a
  masculine Arabic example (`يا بطل`) offered to the model. There is no gender
  column in the schema. Not on anyone's list; filed here so it is on one.
- **Durable resume and per-user analytics are blocked**, not deferred
  ([#25](https://github.com/samtoma/AI.NEXT/issues/25)). `students.id` is a
  per-environment identity sequence that a routine content reseed truncates and
  restarts, bound to a cookie the code itself documents as "not an identity
  claim". Both need the accounts work (`FR-106`) first.

## [PDR1-0-v0.2.0] — 2026-09-16

The first version of the Student MVP solution that can be pointed at. Everything
below was in flight without a version number, which made "which build did you see
that on?" unanswerable — the question every piece of feedback has to start with.

### Added
- **The tutor can see how engaged a student is** (`FR-207`). Reads the last 12
  attempts and gives the tutor a stance — returning, rushing, struggling,
  labouring, steady — never a label to repeat back. Silent below 4 observations.
- **Every objective now carries a question at every difficulty tier** (`FR-1109`).
  The last four gaps were word-problem objectives and were authored rather than
  generated, because templating them produces nonsense.
- **Misconceptions for intersection and mutually exclusive events**, six entries
  mined from the book's own distractors (`FR-1111`, still partial: 43 of 90
  objectives covered).
- **A computed traceability matrix.** `scripts/traceability.py` derives the
  requirement state instead of trusting a hand-edited document: a requirement
  exists because a spec defines it, is traced because a row names it, is covered
  because a test declares it (`@covers FR-nnn`). `--check` fails CI when those
  three disagree.
- **CI actually runs the tests.** 123 of them, which had never run in CI —
  including through two edits to the workflow.
- **The eleven success criteria are traced for the first time.** They are the
  measures the pilot is judged on and had never appeared in the matrix.
- Repository governance: four issue templates tied to requirement ids, a
  pull-request template enforcing the requirement→task→proof thread,
  `CODEOWNERS`, `docs/FEEDBACK.md`, `docs/ROADMAP.md`, `docs/VERSIONING.md` and
  this changelog.

### Changed
- **One branch per solution** (ADR-0010). `PDR1-0` and `family-tutor` are separate
  products, not two environments of one. Constitution **v3.0.0** redefines
  Principle XI from "Comparison Integrity" to "Solution Integrity".
- Each solution branch carries its own deploy trigger. Deploy is **manual-only**
  while infrastructure work is parked.

### Removed
- Cross-solution content parity, the frozen-baseline obligation, and `FR-908`.
  The comparison is now an observational judgement from live usage.
- The simultaneous side-by-side demo — the original promise of ADR-0007.

### Fixed
- `FR-904` and `FR-C05` had been deleted from the matrix by a bad edit that
  overwrote the id column with prose. The matrix silently read 87 rows instead of
  89 for three days, and 87 was published as the requirement count. Restored, and
  the CI gate now catches this class of decay.

### Known broken
- **Uploads do not work end to end** (`FR-205`, marked VERIFIED and it should not
  be). No upload UI exists; the unreadable check misses a trailing admission and
  stores commentary as a transcription; `uploadId` never reaches the tutor prompt.
- **Safety is not built** (`FR-601`, `FR-602`). No crisis classification, no
  escalation. **No real student should use this build until that closes.**
- All 100 refutations and 130 generated questions are live and unreviewed.
