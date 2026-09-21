# Setup that needs Samuel — feature 002

**What this is**: everything feature 002's code is built to consume but that only Samuel can provide
or authorise — credentials, hostnames, legal opinions and four decisions. **Every row has a working
local stand-in**, so none of it blocks testing on a laptop; what it blocks is the box, and a handful
of rows block a requirement from being promoted in
[`traceability.md`](./traceability.md) (**S1** → FR-2006, **S2** → FR-2004, **S4** → FR-2101 on the
box, **S6** → FR-2208, **S7/S22** → FR-2504/FR-2506, **S9** → the governance the voice work assumes,
**S24** → FR-2602's Arabic half).

Accumulated during implementation, 2026-09-20 to 2026-09-21. The S-numbers are stable — cite them
rather than renumbering.

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
