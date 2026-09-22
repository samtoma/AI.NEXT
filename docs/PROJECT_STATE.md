# Project State — AI Tutor MVP

> Living document. Read at session start; update when progress or decisions land.
> Last updated: 2026-09-22 (`feat/002-identity-and-admin-console` at `85fe3b8`; released
> `PDR1-0-v0.4.0`; constitution v3.1.1)

## 📋 THE RECORD MADE TRUE — requirements pass (2026-09-22)

An evening of work on 2026-09-21 shipped four commits and, deliberately, **no requirements at
all**: course availability went out with no FR, no matrix row and a header in every file it
touched saying so, because inventing a requirement to cover shipped work is the drift `CLAUDE.md`
warns about. **Samuel authorised writing them on 2026-09-22.** This pass is that, and nothing in
it is back-dated.

| What | Where |
|---|---|
| **11 new requirements**, each stamped `[ADDED 2026-09-22]` | `specs/002-identity-and-admin-console/spec.md` → **FR-2701…FR-2711**, traced in its matrix **§7b** |
| **ADR-0018 — who may see which course** (Accepted, Samuel, 2026-09-21) | [`docs/decisions/0018-course-availability.md`](decisions/0018-course-availability.md) |
| 001 matrix **rev. 12**, 002 matrix **rev. 3** | both `traceability.md` files |

**Three status changes, and the reasoning matters more than the letters.**

- **`FR-205` — the contradiction is settled.** The matrix had said VERIFIED ("accept uploads from
  anywhere in the lesson") while `SC-009`, eleven rows later, said uploads were unreachable and the
  grounding link was dead. **The second one was right**: FR-205 had been verified in 2026-09-10
  against code that existed rather than a path a student could walk — no surface had a file input,
  and `api/ask/route.ts` never read `uploadId`, so the grounding parameter was `undefined` on every
  turn ever served. The row now carries that history rather than a silent flip. Both are closed by
  `85fe3b8`, and **SC-009's upload guardrail fired for the first time** on 2026-09-21.
- **`FR-1011` is PARTIAL, not VERIFIED.** The variant mechanism is finished and was driven live in
  served HTML — grade → skin at byte 31, an override stored against the student that survives
  sign-out, `"noor"` refused 400, a scan test that fails if any component pins a variant again. But
  `[data-ds="master"]` sets a name and inherits the baseline tokens: **Master's anatomy is
  unpublished**, and ADR-0017 forbids onboarding a Secondary cohort until it is.
- **`FR-905` is BLOCKED, and left standing.** "No Arabic or Social Studies content in this
  environment" is unmet — all three courses are loaded and live for grade 9 on Samuel's own
  instruction. It is **not reworded to match what got built**. Reinstating it is one console action
  per course and unloads nothing; reinstate or withdraw is his call (001 §9 item 13).

**Counts after the pass** — 001: **56 VERIFIED · 17 BUILT · 8 PARTIAL · 6 OPEN · 4 BLOCKED ·
12 DEFERRED** of 104 (plus FR-908 DROPPED). 002: **69 VERIFIED · 2 BUILT · 17 PARTIAL · 2 OPEN ·
1 BLOCKED · 4 DEFERRED** of 95. `./scripts/traceability.py --check` exits 0.

**Three things this pass found and did not fix**, because fixing them is code:

1. **The 2026-09-21 evening has no smoke script.** Every phase P0–P6 closed with one anybody can
   re-run; this work was proved by hand in a browser and psql. Real evidence, not re-runnable.
2. **78 tests prove requirements and declare none of them** — `catalog`, `catalog-gate`,
   `upload-link`, `upload-contract`, `design-variant`, `design-variant-scan`. Each says in its own
   header that it carries no `@covers` because no requirement existed. Eleven do now.
3. **The course gate's undo has never been run.** `AINEXT_COURSE_GATING=off` and
   `scripts/course-gating.sh` are the reversibility Samuel was promised before he saw the feature,
   and there is no record of either being exercised (FR-2709, PARTIAL).

## 🌙 THE EVENING OF 2026-09-21 — four commits, and what each was for

Landed on `feat/002-identity-and-admin-console` after P6. Full reasoning is in the commit messages,
which are written to be read: `git log --format='%h %s%n%n%b' 1ea3e4b..HEAD`.

| Commit | What |
|---|---|
| `c58cb02` | **Course availability.** Two levers — a rule per (course, grade), an exception per (student, course) that wins both ways — over a default of hidden. The refusal lives in the reads, not the interface; a hidden course answers the same 404 a non-existent one does. `content-review` sets a year's rule, `student-data` sets one student's access. Reversible three ways |
| `c510cf7` | **The confirmation moved into the page.** "Live" on an empty course had asked with `window.confirm`, and Samuel's browser suppresses dialogs — `confirm()` returned `false` and the grid read it as "no", so the control failed silently. No native dialog remains anywhere in the product |
| `62f780c` | **Arabic and Social Studies loaded** (84 and 100 objectives). They were never dropped; one line of `local-dev.sh` loaded maths only. The same commit narrowed the local promote step to maths, which stopped it stamping `reviewed_by='local-dev'` on **297 Quran and hadith passages** nobody had read — a false review assertion FR-1110 forbids |
| `85fe3b8` | **Uploads a student can reach** (FR-205/206, SC-009), **two skins chosen before first paint** (FR-1011), the **security record made explorable** (filters, paging, a true total, sign-in history as a mode of the same list), the sessions panel made readable, and the overview's silent fall to Arabic fixed |

**Three latent leaks were found and closed on the way** (002 §9b item 12), none reachable while one
course was loaded and **all three live the moment a second one is**: `/api/attempts` graded any live
question id and returned the correct answer with the full canonical solution; `/spine` shipped every
question across all courses; `?mode=practice` served hidden stems. That is why course availability is
a security feature rather than a preferences screen.

## 🏗️ IMPLEMENTED — identity, isolation and the console (2026-09-21, `feat/002-identity-and-admin-console`)

**Read this first if you are a new session.** Feature 002 is **built, not merged and not deployed**.
Seven phase commits on one branch, each closed by a live smoke script. The record is the commit
messages (`git log --format='%h %s%n%n%b' origin/PDR1-0..HEAD`) and
[`specs/002-identity-and-admin-console/traceability.md`](../specs/002-identity-and-admin-console/traceability.md)
rev. 3 — **69 VERIFIED, 2 BUILT, 17 PARTIAL, 2 OPEN, 1 BLOCKED, 4 DEFERRED of 95**
(rev. 2 read 62/2/13/2/1/4 of 84; the eleven course-availability requirements arrived on
2026-09-22 and are marked as arriving after their code).

| Phase | What shipped | Commit |
|---|---|---|
| **P0** | Learning sessions become real — `sessions` had never held a row; lifecycle wired into four routes, legacy strings backfilled, at most one open session per student as a database invariant | `3747989` |
| **P1** | Accounts, sign-in and isolation enforced by the database — migrations 012–017, fourteen auth endpoints, Argon2id, both tokens HttpOnly, RLS FORCEd on twenty tables, the picker deleted | `66d934c` |
| **P2** | The console as a second build target — `AINEXT_SURFACE`, its own `distDir`, operator sign-in, four roles, the four operator surfaces re-homed and deleted from the student tree | `65d180c` |
| **P3** | Student 360, session list, one-order timeline, reconstructed replay, audited operator reads — plus `renderer_version` stamped at write time so a stale replay is recognisable | `b9e53cb` |
| **P4** | Cost honestly labelled — ledger outcomes and price basis, per-student series, the rollup, subscription status as a record that gates nothing | `0ab095a` |
| **P5** | Monitoring and analytics — the security view, four alert rules plus a shadow rule, GA4 as an audience layer only, cohort overviews and a metric dictionary | `f90daee` |
| **P6** | The tutor's voice — the capture harness repaired, one address seam, the masculine default removed | `1ea3e4b` |

Two commits between phases are not features and are worth knowing about: `2774a79` replaced every
same-client `Promise.all` with a sequential helper (pg@9 removes the implicit queue), and `bdc4f00`
refreshed the generated traceability counts, which had failed CI on every push since P1.

**The proof, all of it run by hand against live servers:** red-team isolation **45/45**, console
smoke **53/53**, P3 **45/45**, P4 **54/54**, P5 **68/68**, P6 green with three live turns and zero
masculine leaks. `npm test` is **423 passing** on HEAD. None of the smoke scripts runs in CI — they
need a database, and CI has none.

### What the work found that nobody had planned for

Six defects, none of them on any list before the phase that hit them:

1. **The application connected to Postgres as a superuser**, and a superuser bypasses row-level
   security unconditionally. Every policy we were about to write would have been inert. `ainext_app`
   is now a non-superuser, non-owner role, and the isolation proof runs *as it*.
2. **The console accepted a student's refresh token**, because localhost cookies are shared across
   ports. Refresh, logout and revocation are surface-bound now, and the console has its own cookie
   names.
3. **Operators could not obtain a password at all.** ADR-0014's bootstrap said to seed one; nothing
   could write it without putting a credential in a config file. Migration 019 lets an operator use
   the ordinary reset flow instead.
4. **Every OCR row in the cost ledger had been written as zeros**, so the upload figure FR-2402 asks
   us to keep separate was structurally zero. It reads the parser's own output now.
5. **The sacred-guard redaction path also wrote zeros** — the guard kills the CLI before its cost
   line — so redacted turns under-reported. Real streamed tokens, repriced at list price.
6. **The prompt byte-identity harness had been broken at HEAD**, which is why every earlier gate
   could only report "fails identically at HEAD". It runs as documented again, and now covers the two
   prompts it had never reached.

And one thing the voice work found that is worse than a defect: **all fourteen widgets narrated
every student's result to the model as "Omar"** — the retired demo student — and the pre-P6 prompt
text was not neutral. It was the masculine register, served to girls.

### What is **not** done

- **Nothing is deployed.** The console has no hostname, no tunnel ingress and no Cloudflare Access
  policy (FR-2208 is OPEN). `ainext.reletix.com` still serves the frozen baseline from `main`.
- **Google sign-in has never run** (FR-2006, the one BUILT row) and **SMTP has never sent a message**
  (FR-2004) — both need credentials only Samuel can provide.
- **GA4 is unconfigured**, so the analytics posture is asserted by unit tests and by the fact that
  nothing renders.
- **No parent view** (FR-2901/2902, deferred by D1) and **no phone+OTP** (FR-2903, deferred by D9).
- **No student can edit her own profile** (FR-2013) **or see where she is signed in** (FR-2009) —
  both are endpoints and data model with no surface on top.
- **No account-deletion path**, and the schema would refuse one: `students_account_id_fkey` has no
  `ON DELETE` action (FR-2310, downstream of the retention decision).
- **The isolation proof is not in CI** (SC-102's "CI-blocking" half).
- **Two follow-ups**: S23 shipped in P6; **S24** — masculine forms outside the vocative in the
  Arabic and social prompts — is open and keeps FR-2602 PARTIAL.
- **The constitution Principle VII amendment is still a proposal.** Gender is now collected and
  operator transcript access is now a logged privilege; the governance that sanctions both has not
  landed (**S9**).

### Setup that needs Samuel — the hand-off

Also kept as [`specs/002-identity-and-admin-console/SETUP.md`](../specs/002-identity-and-admin-console/SETUP.md),
beside the matrix that cites its S-numbers. **Every row has a working local stand-in**, so none of it
blocks testing on a laptop; what it blocks is the box.

| # | Needed for | What Samuel provides | Local stand-in until then |
|---|---|---|---|
| S1 | Google sign-in (FR-2006) | A Google Cloud OAuth 2.0 **Web** client: client id + secret; authorised redirect URIs `http://localhost:3000/api/auth/google/callback` and the future console/student hostnames. Env: `AINEXT_GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | Button renders disabled: "Google sign-in not configured" |
| S2 | Verification + reset mail (FR-2004, FR-2010) | Mailu SMTP on the box: `AINEXT_SMTP_URL` (e.g. `smtps://noreply%40<domain>:<pw>@mail.<host>:465`), `AINEXT_MAIL_FROM`; SPF/DKIM/DMARC already on the sending domain (research R4) | `AINEXT_MAIL_TRANSPORT=console` — links printed to the dev-server log and written to `app/.local-mail/` |
| S3 | Access-token signing | `AINEXT_AUTH_SECRET` (≥32 random bytes) on the box; rotating it signs everyone out | Generated once by `local-dev.sh` into `app/.env.local` |
| S4 | Database roles on the box | Real passwords for `ainext_app`, `ainext_operator`, `ainext_maint` in the box `.env`; `DATABASE_URL` repointed to `ainext_app` (ADR-0012 — without this RLS is inert) | Dev passwords = role names, written by `local-dev.sh` |
| S5 | First operator (ADR-0014) | Confirm `AINEXT_BOOTSTRAP_OPERATOR_EMAIL` = his email; run the reset flow once to set a password | `samuel.s.toma@gmail.com` seeded locally, no password; reset link appears in `.local-mail/` |
| S6 | Console hostname (P2, OCI) | DNS + Cloudflare tunnel ingress for the console hostname; Cloudflare Access policy for it (FR-2208) | Console on `http://localhost:3002` |
| S7 | GA4 (P5) | A GA4 property + measurement id `AINEXT_GA_MEASUREMENT_ID`; confirm the cookieless-on-student-surfaces posture (Open Decision 7) | Wrapper loads nothing when unset |
| S8 | Design artifact | Update the published Noor Play artifact: `--play-inactive-border` → `#9890B5` | Repo tokens already updated |
| S9 | Governance | Approve the Principle VII amendment (v3.1.1 → v3.2.0) — constitution edit on approval | Proposal file in `specs/002-…/` |
| S10 | Legal | Egyptian data-protection opinion on guardian consent for under-15s (PDPL grace ends 2026-11-01) | Consent fields modelled, unenforced |
| S11 | CODEOWNERS | Replace `@tamer-handle` → `@tdeif` (and Kamil's) on every long-lived branch; request Tamer on PR #43 | — |
| S12 | ADR numbering | Decide how to resolve the two files both numbered ADR-0007 | — |
| S13 | Google OAuth library | `arctic@3.7.0` (research R3's pick) is marked deprecated on npm as of 2026-09; it works and the API matches. Decide: keep, or switch to R3's named zero-dependency fallback before the box deploy | Works locally when S1 is configured |
| S14 | Contract tidy (docs) | `contracts/auth.md` emits `failed_signup` on a 409; `contracts/analytics.md`'s closed vocabulary lacks it. Fold one way (code keeps it in a separate `ENDPOINT_EVENT_NAMES` set, flagged) | — |
| S15 | Google first sign-in grade | Google supplies no grade; the code defaults new Google accounts to grade 9 (Prep-3) and lets the student fix it (FR-2013). Confirm, or require grade before account creation (changes the callback contract) | Default 9 |
| S16 | Residual unprincipled read (security review) | Sign-in needs to resolve account → student before a principal exists, so `ainext_app` can read name/grade/interests of any *accounted* student with no principal set (no email, no credential). Tightening path named in migration 017's header (`SECURITY DEFINER` resolver owned by `ainext_maint`). Ask the security-privacy-officer agent to review before the box deploy | Bounded, documented |
| S17 | Security review (content tables) | `questions` carries no RLS by design (curriculum is not student data), but `/api/attempts` accepts a question with `materialised_from IS NOT NULL` — a widget the tutor improvised for one student can be answered by another. Content-only (no answers or mastery leak). Decide: scope materialised questions to their student, or accept | Accepted for the pilot |
| S18 | Security review (console refusal) | FR-2205: a student credential presented to the console is refused on address existence (the console's DB role deliberately cannot read `password_hash`), so on the console 403-vs-401 reveals that an address has a student account. Bounded by Cloudflare Access + operator-only audience. Accept, or make both answers 401 on the console | Accepted for the pilot |
| S19 | Console 403 pages | A refused console page renders a refusal body with HTTP 200 (React Server Components cannot set a status without Next's `experimental.authInterrupts`); API refusals are real 403/401. Decide whether to enable the experimental flag later | As built |
| S20 | `gh` token scope | Pushing commits that touch `.github/workflows/*` over HTTPS is refused: the `gh` OAuth token lacks the `workflow` scope. Run `gh auth refresh -h github.com -s workflow` once (browser step). Meanwhile pushes go over SSH (`git@github.com:samtoma/AI.NEXT.git`), which works | SSH push used |
| S21 | Shared IP throttle (by design) | `auth_throttle`'s IP bucket (20 failures / 15 min) is shared by the student and console processes on one box (research R5). Heavy sign-in testing from one IP can 429 a legitimate operator sign-in until the window rolls. Know it when testing from the office; the smoke scripts reset the bucket themselves | — |
| S22 | GA measurement id | `AINEXT_GA_MEASUREMENT_ID` (a GA4 property per solution — never pooled). Four of the eleven allow-listed events have client triggers today; the rest are server-only and listed in `lib/ga.ts` | Unset → no script renders |
| S23 | ~~Follow-up (voice, client-side)~~ **done in P6** | All 14 widgets and PairPlotter now receive the student's name and register (`widget-address.test.mts` guards it) | — |
| S24 | Follow-up (Arabic prompts) | Masculine forms survive outside the vocative in the Arabic/social prompts (`كيّف حسب رده`, `وجِّهه`, `إذا سأل`). Out of the maths-only scope; do it when the Arabic vertical is next touched, under the harness | Address block instructs the register |
| T1 | Tailnet testing (done, local) | Student `http://macbook-pro.tail9c994e.ts.net:3000` (or `100.76.188.23:3000`), console `…:3002`. Dev servers bind all interfaces; `AINEXT_DEV_ORIGINS` in `app/.env.local` lists the hosts Next may serve dev assets to (`next.config.ts` `allowedDevOrigins`); `AINEXT_PUBLIC_URL`/`AINEXT_CONSOLE_URL` now carry the tailnet name so mailed links open from the iPad. HTTP only (tailnet HTTPS certs are not enabled on this tailnet — `tailscale serve` would need them); cookies are `Secure` only in production, so sign-in works over plain HTTP here | — |

**To try it**:
[`specs/002-identity-and-admin-console/quickstart.md`](../specs/002-identity-and-admin-console/quickstart.md)
— one command, both surfaces, three local identities, and what each check proves.

**Decisions log — one ADR, written after the fact and dated honestly.** Phases P0–P6 added none:
ADR-0012…ADR-0016 were accepted on 2026-09-20 and the implementation follows them. **ADR-0018**
(course availability) records Samuel's decision of **2026-09-21** and was written on **2026-09-22**,
with the requirements it governs. Everything else that looks like a new decision is a row in the
setup table above, which is to say it is still Samuel's.

## ➡️ THE DIRECTION THIS CAME FROM — accounts, and an admin dashboard (Samuel, 2026-09-20)

Samuel's direction at the end of the `v0.4.0` session, recorded verbatim in intent, and now built.
Full detail: [`ROADMAP.md`](ROADMAP.md) § *Samuel's direction*.

**SPECCED 2026-09-20** on `req/identity-and-admin-console` →
[`specs/002-identity-and-admin-console/`](../specs/002-identity-and-admin-console/): spec (70 FRs,
14 SCs), plan, research, data-model, contracts, quickstart, traceability green;
**ADR-0012…ADR-0016**; a constitution Principle VII amendment **proposed** (v3.1.1 → v3.2.0) and
still **awaiting Samuel**. **IMPLEMENTED 2026-09-21** in seven phases on
`feat/002-identity-and-admin-console` — see the section above. The first slice was **Phase 0 —
learning sessions become real**, chosen first because `sessions` was dead schema that had never held
a row and the tie between a tutor turn and its lesson was being lost at write time, every day, with
no later migration able to recover it. It is no longer dead schema.

1. **An admin dashboard, as its own release.** Everything that is not the education
   itself — pipeline, evidence walk, content review, gallery — gets a deliberate home.
   `FR-605` removed them from the student build in v0.4.0; this is the other half.
2. **Real signup and sign-in, with per-student isolation enforced in the backend** —
   his words: *"each student will have his own separate env. now fully, and well from
   the backend."* **He is bringing the full requirements.**
   ⚠️ ~~**This is a multi-tenancy decision and needs an ADR before any code.**~~
   **Resolved 2026-09-20 — Samuel chose database-enforced row-level security**
   (*"row level security indeed, same as reletix"*), recorded as
   [ADR-0012](decisions/0012-per-student-isolation-rls.md): policies on every
   student-scoped table, the principal set on the connection, a forgotten filter
   returning nothing. Schema-per-student is kept as the migration path, not built.
   One correction is on the record there: TalentReletix does **not** use Postgres
   RLS — it filters in application queries — so this is stronger than the reference
   Samuel named, not a copy of it.
3. **Landing page, admin roles, lesson resume** (#6, #7, #8, #9, #25) ride with the
   identity work they were already blocked on.
   **As of 2026-09-21: admin roles shipped** (four of them, per person, one
   authorisation seam — 002 FR-2202/2203). The landing page and lesson resume are
   **unblocked, not built** — they were waiting on accounts and accounts now exist.

**Two decisions settled — do not relitigate:**
- **BKT stays exactly as it is** until Samuel says otherwise. The v0.4.0 display fix
  stands; the band moving two steps on two answers is **known and accepted**, not an
  open defect. [#17](https://github.com/samtoma/AI.NEXT/issues/17) closed.
- **The graph explorer stays a student surface.** `/spine` is not going behind the
  admin gate. This unblocks [#15](https://github.com/samtoma/AI.NEXT/issues/15).

**Samuel is testing the product now and will come back with findings.** Expect new
feedback against `PDR1-0-v0.4.0`.

## 🎨 DESIGN SYSTEM PUBLISHED, AND MADE BINDING — constitution v3.1.0 (2026-09-20)

The design system is now a **published artifact** rather than a Drive handoff:
<https://claude.ai/artifact/SXTAsvPUCjU4ZMp5oZtM6J> (private — needs sharing from the
page's Share menu before Tamer or anyone else can open it).

Extracted from `app/src/app/globals.css`, `docs/design/handoffs/noor-play/` and ADR-0011.
Two colour themes on one semantic token set, mirroring how the code actually works —
**play** (`[data-ds="noor"]`, active) and **ledger** (the frozen baseline). 62 colour
tokens, 16 type styles, 13 components with live previews and guidelines, the three marks
as assets, and four prose sections (motion, bilingual/RTL, layout, the Ledger baseline).

**Constitution → v3.1.0 (MINOR).** New **Principle XII — Design System Authority**: the
published system is the visual authority and **binds every surface we build**, student
product and internal tools alike. Values come from tokens; no literal colour, stroke,
radius or shadow in a component; every coloured background uses its paired `on-`
foreground; a deliberate departure is an ADR, not a local override.

- **Scope widened on Samuel's direction.** ADR-0011 held `/admin`, `/pipeline`, `/spine`,
  `/dev` and `/gallery` out of scope; that carve-out is **withdrawn**. ADR-0011 is marked
  superseded in part; everything else in it stands.
- **Not bound:** the frozen `family-tutor` baseline. It keeps the Ledger identity — the
  same system's second theme. Re-skinning a deployed product is a production change with
  its own release.
- **FR-1001 moved VERIFIED → PARTIAL.** Not a regression: the requirement widened and the
  internal surfaces have never had the Play pass, so they are non-compliant by omission.
  Recorded rather than laundered. Bringing those surfaces onto the system is open work.

**Two contrast errors found in the handoff while extracting, and fixed in the repo:** amber
on ink read 8.1:1 (it is 7.41:1) and violet read 7.4:1 for both foregrounds (white is
5.52:1, the dim `#F0E9FB` is 4.67:1). Every pair still clears AA. A re-sync of the handoff
bundle would restore the wrong figures — there is a note in the table saying so.

**That finding is now decided.** `--play-inactive-border` was `#9c95b8` — **2.84:1** on
white, under the 3:1 floor for a border that carries meaning. It is **specified in the
handoff** as the wrong-answer option border (`docs/design/handoffs/noor-play/README.md:326`)
but is **not consumed by any component**: `globals.css:577` defines it and nothing reads it,
so the description above was of the spec rather than of the build. **Darkened 2026-09-20 on
Samuel's decision** (context in ADR-0017) to the nearest violet on the same hue that clears
the floor — **`#9890b5`, 3.00:1 on white** — in `globals.css`, `tokens.css`, `tokens.json`
and the handoff contrast table.

**Two variants, not one — ADR-0017 (2026-09-20).** ADR-0011's "Master is replaced, not
retained" is reversed: both variants ship and the product picks one per render from the
student's grade (Preparatory → Play, Secondary → Master), with a stored override that
survives sign-out. **Constitution → v3.1.1 (PATCH)** carries the rule in Principle XII, which
also now states that static brand marks satisfy "tokens, never literals" by matching the token
values. The obligation is **FR-1011** — **PARTIAL as of 2026-09-22**, not OPEN and not done:
`globals.css` now names both skins, the variant is resolved server-side from grade and carried on
`<html>` before first paint, and a student's override is stored against her account. What is still
missing is Master itself — `[data-ds="master"]` sets a name and inherits the baseline tokens,
because **Master's anatomy is unpublished**. ADR-0017's rule therefore still holds: **no Secondary
cohort until it is.**

## 🐞 FEEDBACK CLOSED OUT — `PDR1-0-v0.4.0` (2026-09-20, `PDR1-0`)

Full detail: [`CHANGELOG.md`](../CHANGELOG.md) and
[`docs/releases/PDR1-0-v0.4.0.html`](releases/PDR1-0-v0.4.0.html) — the change-by-change
explainer for the founders.

All 37 of Tamer's Prototype 1.1 issues are now answered: **17 closed with code, 20 open
with a written answer.** Every closure cites the commit that fixed it; every open one says
what is true today and what it is waiting on. GitHub Issues is the record — not this file.

Ten fixed in this pass, on top of the seven in v0.3.0. The three worth knowing:

- **#17 / #27 were one cause.** The lesson printed `mastery 30% → 69%` after every answer,
  and four places fed the same raw P(L) into the tutor's prompt, which is where
  "92%, that's excellent" came from. Replayed against the real model, the reported swing
  is *exactly correct BKT* — the defect was showing it. Everything now carries the named
  band. See `CHANGELOG.md`.
- **#10 / #11 / #12 — the student build no longer carries the internal tools.** Tabs gone,
  routes 404. A **build-time switch, not a permission system**; roles still need `FR-106`.
- **#33/#34/#35/#24/#23 — the Socratic cluster.** One cause: every tool the protocol gave
  the tutor for making a student *do* something produced a **card**. No way to express an
  open question — in maths and social. *The Arabic protocol has had that instruction all
  along.* It was written once and reached one of three subjects.

**Three things this pass admits, and they matter more than the fixes:**

1. ~~Access gating and the Socratic protocol have no requirement.~~ **Resolved
   2026-09-20, Samuel approved.** Written as `FR-605`/`FR-606` and `FR-209`…`FR-213`
   (matrix rev. 11). The unmet half of access control became its own requirement
   (`FR-606`, BLOCKED on `FR-106`) rather than a caveat inside the met one.
2. **Nothing in the build can judge teaching behaviour** — now **blocking five named
   requirements**, not an abstraction. `FR-209`…`FR-213` are all BUILT and none can be
   promoted. Scoped as a four-layer **teaching evaluation harness** and queued in
   [`ROADMAP.md`](ROADMAP.md).
   **It surfaced something worse on the way:** `SC-005` — the core bet — is
   *mis-instrumented*, not merely unbuilt. `explanation_delivered` fires only on
   refutations while `retrieval_attempt_submitted` fires on every attempt, so their ratio
   today is *all attempts over refutations only*. A plausible wrong number. `FR-212` is
   what makes it fixable: requiring a lesson to end on a from-memory retrieval creates
   the second moment the metric always needed and never had.
3. **The tutor prompts assume the student is male** — 23 masculine pronouns in
   `lib/lesson.ts` alone, no gender column in `students`. On nobody's list.

**Waiting on a decision from Samuel** (both block work that is otherwise ready):
[#15](https://github.com/samtoma/AI.NEXT/issues/15) — does `/spine` stay a student surface
at all? · [#36](https://github.com/samtoma/AI.NEXT/issues/36) — how much grounding should
a student see?

## 🏷️ RELEASE PREPARED — `PDR1-0-v0.3.0` (2026-09-20, `PDR1-0`)

Three branches merged into `PDR1-0`: `wip/q3-q4-explore` (the Noor
Play skin plus ten Prototype 1.1 fixes), `claude/noor-play-design-system`
(absorbed, no net change — `wip/q3-q4-explore` was cut from it and carries a
later draft of the same triage doc) and `claude/widget-render-fixes`.

**Prepared, not deployed.** Deploy is manual-only while infrastructure is parked
(`T139`). Tagging does not put this in front of anyone.

**Neither tag is on the remote.** Agent sessions can push `refs/heads/*` but get
403 on `refs/tags/*`, so `PDR1-0-v0.3.0` and `PDR1-0-v0.4.0` exist only in this
session's clone and Samuel has to create them. Both, from a clone with push
rights — note that **v0.3.0 points at a commit in the history, not at the head**:

```
git fetch origin PDR1-0

git tag -a PDR1-0-v0.3.0 23df66e \
  -m "PDR1-0-v0.3.0 — Prototype 1.1 feedback, and the Noor Play design system"

git tag -a PDR1-0-v0.4.0 origin/PDR1-0 \
  -m "PDR1-0-v0.4.0 — the fix pass"

git push origin PDR1-0-v0.3.0 PDR1-0-v0.4.0
```

The same 403 blocks branch deletion, so the three branches absorbed into
`PDR1-0` are still on the remote. They are all ancestors of it, so nothing is
lost by removing them:

```
git push origin --delete wip/q3-q4-explore \
                         claude/noor-play-design-system \
                         claude/widget-render-fixes
```

Full detail in [`CHANGELOG.md`](../CHANGELOG.md) and
[`docs/releases/PDR1-0-v0.3.0.html`](releases/PDR1-0-v0.3.0.html) — the
change-by-change explainer, what was implemented and why.

**What this release is really about:** the first time anyone drove the build as
a student rather than as its author, and four requirements marked VERIFIED
failed in front of him (FR-208, FR-1009, FR-1214, FR-1218 — plus FR-C03 reading
"3x6" as 3). Matrix rev. 9 records what he saw beside each fix.

**Still open and named, so nobody has to rediscover it:**
- The **Socratic cluster** (7 issues, `SC-005`) is untouched — the tutor
  explains where it should elicit. Largest item in the feedback.
- `/pipeline`, `/gallery`, `/spine`, `/admin`, `/dev` are **ungated** — no
  environment check, no auth, and the front page links to two of them.
- The tutor prompts **assume the student is male**; there is no gender column.
- Durable resume and per-user analytics are **blocked on accounts** (`FR-106`),
  not deferred.

## 🎨 DESIGN SYSTEM — Master overturned in favour of Play (2026-09-16, `PDR1-0`)

Blocked item #5 below (design: master shipped rather than Play) is resolved: the `[data-ds="noor"]`
skin is now **Play** (ages 10–16 — sticker chrome, Baloo-everywhere typography, 52px targets, 7 named
animations), replacing Master (ages 15–18, restrained). Full replace, not a new switchable variant —
the age-band switching rule was never defined, and Prep-3 (14–15) sits inside both bands anyway.
*(Superseded 2026-09-20 by [ADR-0017](decisions/0017-two-variants-keyed-to-grade.md): Samuel defined the
rule — both variants stay, selected at runtime by grade. Kept here as the journal entry it was.)*

Handoff bundle: `docs/design/handoffs/noor-play/` (`design_handoff_nour_play` v1.0a — CLAUDE.md,
tokens.css, tokens.json, reference/). Decision record: `docs/design/noor/README.md`.

**Shipped this pass:**
- Full token/colour/typography/motion layer in `app/src/app/globals.css` under `[data-ds="noor"]`:
  the sticker system (3px ink outlines, hard offset shadows, 14/20/28/999 radii, `.play-pressable`),
  the seven named animations, and blanket radius/border-width safety nets so any plain
  `rounded-*`/`border` utility picks up the new look with no component touched.
- Component-level sweep, additive-only, over `components/student/*` and `components/chat/*` (press,
  shadow and animation classes wired onto real buttons, cards and chat bubbles).

**Explicitly out of scope this pass:** internal tooling under `/admin`, `/pipeline`, `/spine`,
`/dev`, `/gallery`; the per-widget SVG verdict-ink colours in `components/student/widgets/*`.

**Resolved 2026-09-20:** recorded as [ADR-0011](decisions/0011-noor-play-design-system.md),
accepted by Samuel authorising the `PDR1-0-v0.3.0` release.

## 🌿 ONE BRANCH PER SOLUTION — ADR-0010 (2026-09-13)

Samuel's call: **no more two environments inside one branch.** The baseline and the Student MVP are
two *solutions*, not two deployment slots of one product. Each gets its own long-lived branch, kept
in parallel indefinitely.

| Branch | Solution | State |
|---|---|---|
| `main` | shared trunk, still the default and still what CI deploys | untouched |
| `family-tutor` | Founding Families — parent-sold, Arabic RTL, 3 subjects, Elo | frozen baseline, branched from `main` |
| `PDR1-0` | Student MVP — student-facing, English LTR, math only, BKT | active development |

`PDR1-0` is the rename of `claude/tamer-shared-drive-access-ddpypu`, whose name was an artefact of
how the session was created. The old remote ref was deleted; both were at `544fe6e`.

**What this withdraws:** ADR-0007's *delivery model* — two stacks co-tenant on one box, two
hostnames, parity asserted between two live databases, and a simultaneous side-by-side demo.
**The side-by-side demo is given up**; if it is still wanted it is new work (T138). Product scope
from ADR-0007 is untouched. Parity is now asserted per branch against the held-constant book.

Phases 1 and 3 were re-cut against this; the implementation strategy section was rewritten. New
tasks: **T136** (re-point `mvp1` in CI/deploy — it names a branch that no longer exists), **T137**
(retire `main`? production change, blocked on Samuel), **T138** (re-specify or drop the side-by-side
demo). Resume doc: `docs/WIP-branch-per-solution.md`.

**Clarified later the same day (ADR-0010 Clarification).** Samuel: *"each branch with its own
deployment triggers on their own branches… the comparison will be on the live usage… I will not rely
on the system to compare, the 2 systems can be completely different… don't touch the main now."*
This goes further than the branch split:

- **Cross-solution content parity is withdrawn.** The book is no longer a held-constant variable
  *between* solutions; they may diverge completely. `FR-904` and `SC-001` re-cut to a per-solution
  drift guard; `parity_check.py` is kept in that narrower role (it has caught two real defects).
- **`FR-908` dropped**, with `T059`/`T060` — they required a PR to `main`.
- **`main` is not to be touched.** `T137` (retire `main`) answered: **no, not now**.
- **`T138` (side-by-side demo) answered: dropped.** No system-enforced comparison surface.
- **`T136` reframed**: give each branch its own deploy trigger instead of one branch→environment
  matrix. Must not add or change any trigger on `main`.
- **Constitution → v3.0.0 (MAJOR).** Principle XI "Comparison Integrity" redefined as **"Solution
  Integrity"**: attribution, no pooling, no student data crossing, and a per-solution drift check.
  The frozen-baseline obligation is withdrawn — a baseline is frozen because nobody is working on
  it, not because an experiment depends on it.

Named honestly in the ADR: with parity released, any later claim that one solution teaches better
than the other is an opinion formed from live usage, **not a measured result**.

**Task ledger reconciled the same day** — work had been done and never ticked. `T043`, `T073`,
`T107`, `T121` closed with evidence; `T104` and `T111` had stale numbers corrected. Counts now
**94 done / 44 open / 138**.

⚠️ **Phase 7 is marked complete and is not.** No task in it ever built a UI, `T046`'s unreadable
check is broken (anchored regex stores model commentary as a transcription), and `T048`'s grounding
link is dead (`uploadId` never passed by the only caller). ⚠️ **Phase 11 (safety) is 0/6 and is a
declared hard gate** — no real student until it closes; `T067` needs Samuel to name the escalation
recipient.

---

## 🔗 WIDGETS ARE QUESTIONS — ADR-0009 (2026-09-13, `claude/tamer-shared-drive-access-ddpypu`)

Samuel asked whether the new widgets bind to the generated question bank, the misconception
catalogue and the lessons. **They did not, on all three** — and the reason was structural, not an
oversight: `attempts.question_id` is NOT NULL and references `questions`, so a widget outcome could
never be recorded, diagnosed, counted or made to move mastery unless the widget is a row there.
Asked for the best fix rather than the cheapest, the answer was to unify the two content supply
chains.

**A widget is now a question.** `question_type='widget'`, with the construction and its diagnostics
in `choices` — the same column that already carries `misconception_id` per option for multiple
choice. The generalisation that makes it exact: *an MCQ's distractors are its enumerated wrong
answers; a widget's PREDICATES are the same thing over a continuous answer space.* The client
reports structure, the server decides meaning, and the pedagogy becomes reviewable data instead of
code.

- **48 stored widget questions**, 13 objectives, 20 families, 75 predicate→misconception mappings,
  through the same generate → validate → load → sample pipeline as the 543 generated items.
- **16 new misconceptions** for errors only a construction reveals. You cannot write a
  multiple-choice item that catches "thinks a diameter is any long chord"; you can see it instantly
  from where the two ends go. A wrong option can be a guess — a wrong construction rarely is.
- **The refutation now reaches the student.** It was already looked up and logged to analytics, then
  discarded in favour of the question's generic solution — so the text written for the exact
  mistake reached a dashboard and never the child who made it.
- **Samuel's decisions** (ADR-0009): widget attempts *do* move BKT, tagged by `modality` so every
  metric can be recomputed without them; stored widgets are preferred and inline composition stays.
  Those collide, so an inline widget **materialises** into a reviewable row on first answer — and
  the database refuses to let a materialised row go live, by CHECK constraint rather than by
  convention.

**What the curriculum graph caught that code review would not.** Diagnostics may name a
misconception on the question's objective *or any transitive prerequisite*, verified against the
graph. That check rejected two content errors mid-generation: a chord misconception authored on the
diameter-theorem objective instead of the definitions one, and a linear-functions sketch reaching
for a coordinate-geometry misconception taught three units later. Both would have diagnosed
confidently and explained something the student was never taught.

**Open, and honest:** no tutor turn has yet pushed a stored widget (T119); 20 widget questions are
queued for review and the review page cannot render a construction yet, so every widget a student
sees is unreviewed (T122); 13 of 90 objectives are covered (T123); and every comparison metric now
needs slicing by modality (T135).

102 tests pass. Live bank: 1041 questions (491 mcq, 502 numeric, 48 widget) · 94 misconceptions.

---

## ✏️ WIDGETS — every module is now something a student can DRAW on (2026-09-12, `claude/tamer-shared-drive-access-ddpypu`)

Samuel asked for "more widgets… with more option to draw and better capability". The measured
starting position: **two** interactive widgets, both tap-only, serving **2 of 10** modules.
Geometry — 72 of the book's 212 figures, the largest category — had none. The only student
gesture anywhere in the product was a single click.

Now **eleven** widgets across **10 of 10** modules, six of them drag-to-construct and one
freehand. Built on one shared interaction primitive (`widgets/drag.ts`) rather than nine
hand-rolled pointer handlers, which is where the "better capability" actually lives.

- `line_drawer` · `circle_builder` · `angle_setter` · `triangle_ratio` · `bar_builder`
  `number_line_marker` · `ratio_balance` · `sample_space` · `curve_sketcher`
- They grade the **property**, not a stored position: any of the 66 chords is a chord, any two
  points on the line are the line, any similar triangle has the same tangent — and the widget
  says so. A wrong answer returns a **diagnosis** ("that is the median, not the mean"), not a
  score.
- Payload validation is a React-free module with 18 tests. It **rejects rather than repairs**,
  including well-typed but unreachable targets — an angle off the snap grid, sin θ = 1, a fourth
  term of 40/3. A widget that cannot be answered correctly marks a correct answer wrong.
- The tutor is documented **per unit**, not per subject: eleven schemas in every prompt is both
  a cost and a menu.
- **`/dev/math-widgets`** renders all fifteen cases with the payload that produced each, plus
  five payloads that must refuse to render. That is the review surface — "drag it and see
  whether the mathematics holds" is not a code review.

**Two pointer bugs that reading the code would never have caught**, both found by driving the
widgets in a real browser and both worse for students than for the test: `pointermove` gated on
React state dropped every move dispatched before the re-render committed (fatal on a
touchscreen, where the first events arrive a millisecond apart — the iPad is the device target),
and a missing `preventDefault` let the browser start a native selection and fire `pointercancel`
**mid-drag**, stranding a handle a third of the way to where it was pulled with no error
anywhere. Both confirmed fixed in Chromium.

**Verified end to end in a browser**, not just typechecked: a line dragged to `y = 2x − 1`, a
chord onto (−3,4)–(4,−3), an inscribed angle set to 35° with the 2:1 relationship holding, six
tapped cells giving P = 6/36 = 1/6, and a freehand parabola at 0.04 mean error. 89 tests pass.

**Open, and Samuel's to decide:**
- **T119** — no tutor turn has ever *chosen* a widget. The prompt documentation is written and
  tested; which widget a model reaches for at a real teaching beat is unmeasured, and it decides
  whether any of this reaches a student.
- **T120** — never run on a real iPad. Touch is verified only under synthetic pointer events,
  which is exactly the setting that hid both bugs above.
- **T121** — widget outcomes deliberately do **not** move mastery (FR-1211), to keep the
  comparison clean. A student can construct every chord in the unit and the number will not
  notice. Worth an explicit decision rather than an inherited default.

---

## 🏗️ BUILD IN FLIGHT — Student MVP 1.0, 49/80 tasks, nothing on the box yet (2026-09-10, `claude/tamer-shared-drive-access-ddpypu`)

**Read [`specs/001-student-mvp1-delta/traceability.md`](../specs/001-student-mvp1-delta/traceability.md) first** —
it maps all 82 functional requirements to the code that implements them and the evidence that
proves it, and it is deliberately harsher than `tasks.md`: a requirement whose code exists but has
never been executed does not count as done there.

**Two environments, one book.** Baseline `main` → `ainext.reletix.com` stays frozen. Comparison
`mvp1` → **`ainext-mvp1.reletix.com`** — note the single label: Cloudflare Universal SSL wildcards
match exactly one, so a nested `mvp1.ainext.…` fails TLS before Access is ever reached
(research.md R6).

**Done and exercised against real data (VERIFIED):**
- **BKT mastery** replaces Elo — pure `lib/bkt.ts`, bitemporal evidence trail, all six contract
  invariants tested. Live walk: 0.3000 → 0.1458 → 0.4909 → 0.8314 → 0.9612, saturating at 0.9800
  and still dropping to 0.8737 on one wrong answer.
- **Retrieval seam** (`lib/retrieval.ts`) — the single grounding composition point.
- **Environment attribution** on every event, ledger row and cost record, from configuration only.
- **Content-parity gate** (`parity_check.py`) — proven to catch its target failure: a fresh scoped
  load reports 450 total but only **421 live**, which a totals-only check would have called parity.
- **Per-topic dashboard** with no blended aggregate computed anywhere.
- **Identity as a picker**, grade + interests captured, validated server-side.
- **The Nour design system**, applied as one token block under `[data-ds="nour"]`.

**Written but never met the box (BUILT):** the `ainext-mvp1` compose stack, the explanation/
refutation pipeline, upload parsing through the on-box Claude CLI, the CI branch→environment matrix.

**Runs locally today**: `./scripts/local-dev.sh` — Postgres, migrations, the full math bundle and
the app. See `docs/LOCAL-DEV.md`.

**Blocked on Samuel, in priority order:**
1. **T067 — name the crisis-escalation recipient.** Phase 11 safety is a hard gate before any real
   student, and an unmonitored channel produces a record that looks like a safeguard and is not one.
2. **FR-306** (mid-year placement) and **FR-402** (exam preparation) read as in-scope and are
   unbuilt — build or defer explicitly.
3. **SC-007** is not buildable as written; **SC-004** still references "verified signups", which
   decisions.md Q5 replaced with the picker.
4. **T001** — create and push the long-lived `mvp1` branch.
5. Design: **master** variant shipped rather than **Play**; reversible as a token swap.
   Resolved 2026-09-16 — switched to Play, see the entry at the top of this document.

## 🔀 NEW PRD ADOPTED — scope locked, constitution v2.0.0, ready to build (2026-09-08, `claude/tamer-shared-drive-access-ddpypu`)
**`PRD: AI Tutor — Student MVP` v0.4** (Tamer Deif, Drive `1gUAF0IyHRBr47k7aqiPxe9q22CJy8A7JwVqI405bRnk`)
is now the product authority. It is **not an increment** on the PoC — student-owned, English-first,
iPad/desktop, BKT instead of Elo, Math-only, plus uploads, dashboards and a parent view.

**Samuel's decision (ADR-0007): build it as a side-by-side comparison on the same book.** Twelve scope
questions answered verbatim in `specs/001-student-mvp1-delta/decisions.md`. Headlines:
- **Purpose:** a comparison experiment, not a replacement. `ainext.reletix.com` stays frozen and alive.
- **Hypothesis:** does it teach better? Judged on the PRD §12 metric (comprehension → completed
  retrieval attempt), with **real pilot students**, both environments instrumented, never pooled.
- **Constant:** the same Prep-3 Math EN book — verified **10 modules, 90 LOs, 112 `prerequisite_of`
  edges, 450 questions, 212 visuals**. Parity enforced by an automated check that fails on drift.
- **Variable:** the whole PRD experience (accepted: a result can't be attributed to one change).
- **No auth** — a student dropdown + dead-simple "create new user" (grade + interests captured there).
  Bonus: identity is now held *constant* across both sides, which makes the comparison cleaner.
- **In:** uploads+OCR, student dashboard, parent view+alerts. **Out:** trial & payments (Epic G).
- **English LTR chrome, direction kept switchable** — math was already taught in English; Arabic and
  Social Studies stay reintroducible.
- **Refutation library ships pipeline-generated and UNREVIEWED** (no reviewer exists yet), bounded by
  **Cloudflare Access** with an invited 10–20 family cohort, every entry attributed + `reviewed:false`.
- Parent reaches the read-only view through the same picker (accepted: any pilot parent sees any pilot
  student — must not survive into a public build).
- **Timeline: ASAP**, continuous, using the agent team.

**⚖️ Constitution amended v1.0.0 → v2.0.0** (Samuel: *"go for it and update the principles"*):
III Review Gate **suspended** for generated explanation content in the comparison env only (reversible,
attributed, Access-bounded); V becomes *Bilingual by Construction, English-First*; VI's EGP 40 ceiling
detached pending PRD §10 pricing (instrumentation + turn caps still binding); VII student-owned;
VIII non-goals replaced with PRD §14; **XI Comparison Integrity added** (parity, env attribution,
frozen baseline, no cross-env student data). I, II, IV, IX, X unchanged.

**Artifacts:** `specs/001-student-mvp1-delta/` — `spec.md` (re-cut against the decisions),
`delta-matrix.md` (full diff + §7 what the decisions cut), `decisions.md`, `checklists/requirements.md`;
`docs/decisions/0007-student-mvp1-comparison-build.md`; `.specify/memory/constitution.md` v2.0.0.

**Top risks carried knowingly:** (1) unreviewed generated teaching reaching real students, *inside the
metric being measured*; (2) the "frozen" baseline still needs metric instrumentation — that change must
be provably behaviour-neutral or it stops being a baseline; (3) safety escalation implies a human on
the channel and **that owner is still unnamed**.

**Next:** `/speckit-plan` — now unblocked, since the governance question is resolved.

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
| ADR-0007 | Two distinct decisions share this number: PRD supersession — "Student MVP" (International) replaces "Founding Families" (Bakaloreya) (`0007-prd-supersession-student-mvp.md`); and Student MVP 1.0 built as a side-by-side comparison on the same book (`0007-student-mvp1-comparison-build.md`) | ✅ Accepted 2026-09-02 / 2026-09-08 |
| ADR-0008 | Generate the question bank, review a 10% sample | ✅ Accepted 2026-09-10 |
| ADR-0009 | An interactive widget is a question | ✅ Accepted 2026-09-12 |
| ADR-0010 | One branch per solution, both long-lived | ✅ Accepted 2026-09-13 |
| ADR-0011 | Noor Play replaces Master as the Student MVP design system | ✅ Accepted 2026-09-20 · amended by ADR-0017 |
| ADR-0012 | Per-student isolation is enforced by the database — Postgres RLS, forced, principal on the connection, a non-superuser app role | ✅ Accepted 2026-09-20 |
| ADR-0013 | Student-owned accounts, parent-linkable, with Reletix-pattern sign-in; phone+OTP designed not built; gender collected | ✅ Accepted 2026-09-20 |
| ADR-0014 | The admin console is a second build target of one codebase — own hostname, Cloudflare Access *and* four per-person roles | ✅ Accepted 2026-09-20 |
| ADR-0015 | One interaction timeline per student per session, replayed by reconstruction; every operator read audited | ✅ Accepted 2026-09-20 |
| ADR-0016 | Analytics and monitoring: three layers, one system of record — first-party events, anonymous GA4 as audience layer, console as presentation | ✅ Accepted 2026-09-20 |
| ADR-0017 | Two design-system variants ship — Play and Master, one per render, keyed to the student's grade with a stored override; amends ADR-0011's "Master is replaced" | ✅ Accepted 2026-09-20 |

## Key metrics to watch (once live)
50 paying families · ≥60% M2 retention · diagnostic score lift at day 45 · ≥3 sessions/week/student ·
per-student AI spend **measured, no ceiling set** — the EGP 40 figure came from a parent price band
the new PRD withdrew, and constitution v2.0.0 Principle VI detached it pending PRD §10 pricing
(Samuel, 2026-09-12: *"I don't want a ceiling to be applied yet, we will make it in the future"*).
Instrumentation and per-surface turn caps remain mandatory.
