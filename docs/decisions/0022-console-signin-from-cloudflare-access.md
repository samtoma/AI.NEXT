# ADR-0022 — Console sign-in from the Cloudflare Access identity

**Status**: Accepted — Samuel, 2026-09-24: *"the email verification is done through cloudflare, can you use this email from cloudflare"*
**Amends**: [ADR-0014](./0014-admin-console-second-build-target.md) — "Cloudflare Access proves you are on the invite list. The account and role prove you are permitted." Access now also proves **which** account. · `specs/002-identity-and-admin-console/contracts/auth.md` §Operator authentication (password becomes the fallback)
**Affects**: `app/src/lib/auth/cf-access.ts`, `operator-signin.ts`, `console-signin.ts`, `dev-picker.ts`, `principal.ts`, `throttle.ts` · `app/src/app/api/auth/cloudflare/route.console.ts` · `app/src/app/api/auth/dev-operator/route.dev.console.ts` · `app/src/app/(auth)/signin/page.tsx` · `app/src/components/console/OperatorSessions.tsx` · `app/src/app/(console)/security/page.console.tsx` · `app/next.config.ts` · `app/scripts/check-surface-manifest.mts` · `deploy/docker-compose.mvp1.yml` · `.github/workflows/ci-cd.yml` · `scripts/local-dev.sh` · `.claude/launch.json` · **FR-3301…FR-3312**
**Depends on**: [ADR-0013](./0013-student-accounts-and-sign-in.md) (the session model), [ADR-0014](./0014-admin-console-second-build-target.md) (the console build, and Access in front of it)
**Amended**: 2026-09-24, the same day, before merge — a security review of the branch (findings F2–F11). Every behaviour it changed is written into the Decision below and marked *(review Fn)*; one finding (F4) is **not** a code change but an [open decision for Samuel](#open-decision-for-samuel--the-console-is-reachable-without-cloudflare-review-f4); one (F8) is an [accepted risk](#accepted-risks).

## Context

The console at `admin-noor.reletix.com` sits behind a Cloudflare Access application (team
`reletix`, one-time email PIN). To reach the console at all, a person has already proven an email
address to Cloudflare. Then the console asked them to prove *an* identity again, with a password.

Two proofs, and nothing tied them together. Access proved person A was at the keyboard; the
password proved the keyboard knew account B's secret. Nothing checked that A was B, so the audit
trail — every `operator_reads` row, every role change, every course decision — named an account,
not a proven person. The password also had to be obtained first, through a reset mail that depends
on SMTP working on the box.

Samuel's decision is the obvious one: use the address Cloudflare already verified.

## Options considered

**(a) Keep password-only.** The status quo, and the gap described above. Rejected.

**(b) Trust `Cf-Access-Authenticated-User-Email`.** Cloudflare adds this plain header to every
request it lets through. It is the easiest thing to read and the wrong thing to trust: it is a
header, and anything that reaches the origin by another route — a misrouted tunnel ingress, a port
opened for debugging, a `curl` on the box — can set it to any address it likes. The origin cannot
tell who set it. Rejected, and the code is tested never to read it.

**(c) Verify `Cf-Access-Jwt-Assertion`.** Cloudflare also adds a JWT, RS256-signed with the team's
private key, whose public half it publishes at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.
It carries the application's AUD tag, the team issuer, an expiry and the email. It cannot be forged
without Cloudflare's key. **Chosen.**

**(d) Cloudflare as an OpenID Connect provider** (Access for SaaS). A full OAuth round trip with a
client secret, a callback route and a second Access application to configure. More moving parts for
the same proven email, and a secret to rotate. Not needed while the console sits behind Access
anyway; revisit if the console ever has to be reachable without it.

## Decision

**The console signs an operator in from the verified Access assertion, and nothing else about
Cloudflare is trusted.**

1. **The JWT is verified, not the header.** `jose`: `createRemoteJWKSet` over the team's certs URL
   (cached; refetched only when an unseen key id appears), `jwtVerify` with `algorithms: ["RS256"]`,
   `issuer` = the team domain, `audience` = the console's Access application AUD, `exp` required,
   `nbf` honoured, 30 seconds of clock tolerance. The email is read from the **verified payload**,
   lower-cased, and matched against `operators.email` case-insensitively and exactly — no domain
   rule, no prefix. A token with no email (an Access service token) proves a machine, not a person,
   and is refused. *(review F7)* **The address must be plain ASCII**, and every comparison goes
   through one function, `canonicalOperatorEmail`: the route's SQL lookup (`lower()`) and
   `principal.ts`'s per-request check (JS) used to lower-case by two different rules, which
   disagree outside ASCII (the Kelvin sign, dotted İ), so an address one matched and the other did
   not would loop between `/signin` and the route. A proven address outside ASCII is refused as
   `non_ascii_email` — no proof, so the password fallback still works for that person — and a row
   SQL finds counts only if the one rule agrees. The keys are cached for **one hour** *(review F9;
   was ten minutes)*: `jose` does not serve stale keys, so the cache age is how often a slow key
   endpoint can reach a request at all; rotation still lands at once through the unknown-key-id
   refetch.
2. **It fails closed.** Feature off, a team domain with no AUD, no header, a token that does not
   verify for any reason, keys that cannot be fetched — each is "no proof", and no proof signs
   nobody in. Half a configuration is the one worth naming: a team domain without the AUD would
   verify tokens minted for **any** application of the team, so it is treated as off (and logged),
   never as "verify without the audience".
3. **The seam is a console-only route the sign-in page forwards to.** `/signin` is a Server
   Component and cannot set cookies; `proxy.ts` runs in its own runtime and must not reach the
   database. So the page decides ("this request carries an assertion") and redirects once to
   `GET /api/auth/cloudflare` — a `route.console.ts`, absent from the student build — which
   verifies, looks the operator up, starts the session and redirects on. It lives under
   `/api/auth` because that is where the console's refresh cookie is sent, so it can see the
   session the browser already holds. Every failure returns to `/signin?cf=…`, and the page never
   forwards a request carrying `cf`, so there is no loop. *(review F6)* **Only a top-level
   navigation starts a session**: a GET that creates a session is one any other site can make a
   browser send (`<img>`, `<iframe>`, a prefetch), and Cloudflare admits it whenever the browser
   holds its Access cookie. The route answers a bare `403` — before reading, verifying or recording
   anything — when `Sec-Fetch-Dest` is present and is not `document`. Absent is allowed: every
   supported browser sends it, and a client that does not still needs a verified assertion.
4. **Same session as a password sign-in.** `createAuthSession`, the same `auth_sessions` row, the
   same 7-day sliding / 30-day absolute expiry, the same refresh rotation afterwards, the same
   cookies. Downstream of the sign-in nothing can tell the two apart — `principal.ts`,
   `authorize()` and every role check remain the one seam (FR-2106). An existing session for the
   same operator is **rotated**, not duplicated, so an access cookie's 15-minute expiry does not
   add a row to the session list every quarter of an hour.
5. **The proven person wins.** If the browser holds a console session for a *different* operator,
   that session is ended (revoked in the table, `session_revoked` with reason
   `cloudflare-access:identity_changed`) and the proven person is signed in. On every console
   request `principal.ts` treats an operator session as signed out when a **verified** assertion
   names another address — which is what sends the browser back through the route. A missing or
   broken assertion changes nothing about an existing session: that is what keeps the password
   fallback usable if verification ever breaks. *(review F9)* **That per-request check waits at
   most one second** (`IDENTITY_CHECK_BUDGET_MS`). A check that has not finished by then is "no
   proof", which keeps the session — exactly the answer a request with no assertion gets — so a
   Cloudflare key endpoint that hangs costs each console request a second, not the five-second
   fetch timeout, and never signs anybody in or out.
6. **No account, or a disabled one → a refusal, never a session.** "This Cloudflare identity has no
   console account", with a link to sign out of Cloudflare and no password form (a password
   session for somebody else would be ended on its next request by rule 5). Any other operator's
   session on that browser is ended too: whoever it belonged to, it was not the proven person's.
7. **Recorded in the existing vocabulary.** A Cloudflare sign-in is `operator_login` — the
   console's sign-in event (contracts/analytics.md #12), which the Security view already counts —
   with `reason` = `cloudflare-access:<roles in effect>`. A second event name would split every
   operator sign-in count in two. Refusals are `failed_login`: `cloudflare-access:no_operator:<email>`
   (the one place an address is written into `auth_events.reason` — an operator's or would-be
   operator's, never a student's), `cloudflare-access:disabled`, and
   `cloudflare-access:unverified:<code>` for an assertion that did not verify. No token, signature
   or claim beyond the proven address is ever logged or stored. A password lockout (FR-2011) does
   not block an Access sign-in: the lockout defends a password against guessing, and this path
   takes no password. *(review F11)* **The unverified refusals are recorded within a budget**, in
   `auth_throttle`'s 15-minute windows: 20 per client address (`cf_unverified_ip`; the 20th also
   records one `suspicious_activity`, `cloudflare-access:unverified_ip_throttled`) and 200 in total
   (`cf_unverified_all`; one `cloudflare-access:unverified_flood` at the ceiling). The total is the
   one that bounds the table: off Cloudflare the address comes from `cf-connecting-ip`, which the
   caller writes, so a caller rotating it never meets the per-address limit. Only the *record* is
   limited — the answer is the same `cf=invalid`, a valid assertion is never affected, and these are
   not the password path's `ip` counter, so a broken Access setup cannot spend an operator's
   password budget. The Security view's note on the reason column now says that a `no_operator`
   refusal carries the proven address.
8. **Sign-out goes through Access.** Ending the console session alone would be undone by the very
   next request, which would carry a valid assertion straight back into a new session. With the
   feature on, the console's sign-out — and the refusal page's "Sign out of Cloudflare" — sends the
   browser to **`/cdn-cgi/access/logout` on the console's own hostname** after ending its own
   session. *(review F3; was the team-wide `https://reletix.cloudflareaccess.com/cdn-cgi/access/logout`.)*
   Both URLs revoke the person's Access tokens, but revocation takes 20–30 seconds to reach every
   edge and each URL deletes the Access cookie only on its own domain. The team URL left the
   console's `CF_Authorization` cookie in place, so for those seconds the next console request
   carried a valid assertion and signed the person straight back in. The app URL deletes that cookie
   at once; Cloudflare answers it at the edge and it never reaches the origin.
9. **Password sign-in is kept, as the fallback.** It is not shown while a verified identity is
   present, and it is shown — with a one-line notice — when the assertion could not be verified.
   Samuel may remove it later; that is a separate decision.
10. **The team domain and the AUD are configuration, not code and not secrets.**
    `AINEXT_CF_ACCESS_TEAM_DOMAIN` and `AINEXT_CF_ACCESS_AUD`, on the console service only. CI writes
    them from repository *variables* with the production values as defaults; unset in the app means
    off. The AUD identifies an application; it authorises nothing without Cloudflare's signature.
    *(review F10)* CI validates both before writing `deploy/.env` — the team as
    `^https://[a-z0-9-]+\.cloudflareaccess\.com$`, the AUD as `^[0-9a-f]{64}$`, whole-string — and
    fails the deploy with an error naming the variable, rather than letting the app quietly treat a
    malformed value as "off" behind a green deploy. `off` switches the feature off in any letter
    case. Both values get the same single-quote escaping as every other `.env` key.
11. **Locally, a dev operator picker — locked three times.** There is no Cloudflare in front of a
    laptop. `/signin` on the console lists "Sign in as <operator>" only when **all** of: `NODE_ENV`
    is not `production`; `AINEXT_DEV_OPERATOR_PICKER` is exactly `on`; the request is to this
    machine. The endpoint checks all three itself (hiding a button is not authorisation, FR-2107),
    and it is named `route.dev.console.ts`, a page extension `next.config.ts` adds only outside
    production — so `next build` does not compile it and `npm run check:surface:admin` fails if it
    ever appears. Picker sign-ins are recorded as `dev-picker:<roles>`. *(review F2)* **The third
    lock is the loopback bind, not the headers.** `next dev` listens on every interface, and the
    server's own check can only read Host, Origin and `X-Forwarded-For` — every one written by the
    client (Next fills `X-Forwarded-For` from the socket only when the request brought none). Anyone
    on the same Wi-Fi could send `Host: localhost` and be any operator. So `scripts/local-dev.sh`
    and the `tutor-console` entry in `.claude/launch.json` start the console with `-H 127.0.0.1`
    whenever the flag is set, and then nothing off the machine can connect at all; the header checks
    remain, now also refusing `Origin: null`, and stop a browser on another machine, a cross-site
    form post and a sandboxed frame — not a hand-built request. **A console started by hand without
    `-H 127.0.0.1` is not protected by lock 3**, and the docs say so where the flag is set.
12. **The student surface ignores all of it.** The route does not exist in the student build;
    `readAccessAssertion` answers null for the student surface without reading a header;
    `principal.ts` consults the proof only when `IS_CONSOLE`; neither variable is set on the
    student service.

## Accepted risks

**`?cf=` is read from the URL (review F8).** The outcome codes the route hands back to `/signin`
(`no_account`, `disabled`, `invalid`, `error`, `unavailable`) are query parameters, so anyone can
link an operator to `/signin?cf=no_account` and the page will show the refusal. **Accepted, no code
change.** It is UI spoofing only: no session is started, ended or kept by it; the refusal page's
address is re-verified from the request's own assertion, never taken from the URL, and reads "this
address" when there is none; an operator already signed in is sent on before the parameter is
read; and the worst outcome is a confused operator who clicks "Sign out of Cloudflare" and signs in
again. Making the code trustworthy would mean signing it or re-deriving it with a database lookup
on every render of the page, which is more machinery than a misleading sentence warrants.

**No proof keeps a session.** Stated in rule 5 and FR-3306 and repeated here because the review
leaned on it twice (F4, F9): a request with no assertion, an unverifiable one, or one whose check
timed out leaves an existing console session alone. That is what keeps the password fallback usable
when verification breaks — and it is why a request that reaches the console *without* Cloudflare is
the open question below.

## Open decision for Samuel — the console is reachable without Cloudflare (review F4)

**The fact.** The `console` container joins the external `mailu-network` (to relay mail through
Mailu's postfix, which authorises by network membership — the `networks:` block of
`deploy/docker-compose.mvp1.yml`). Every container on that network — Mailu's own, including its
internet-facing webmail and admin, and the Talent stack's — can open `http://<console>:3000`
directly, with no Cloudflare in between; so can anything on the box's loopback (`127.0.0.1:3102`).
On that path the password form is reachable (throttled and locked out per FR-2011, but reachable),
and **a stolen console cookie is honoured**, because a request with no Access header is "no proof",
and no proof keeps the session. Through Cloudflare the same stolen cookie is useless unless the thief
proves the same address — rule 5 ends it.

**Behaviour is NOT changed in this pass.** It is a trade between exposure and break-glass access,
and that is Samuel's call.

| | What it is | What it closes | What it costs |
|---|---|---|---|
| **(a) Strict mode** | With Cloudflare sign-in configured, the console honours an operator session — and accepts a password sign-in — only on a request carrying a **verified** assertion. | Every off-Cloudflare path at once — the Mailu network, loopback, a misrouted tunnel ingress — in code, testable. | **Break-glass.** SSH port-forwarding to `127.0.0.1:3102` stops working for operators, so it needs its own switch (another variable, or `AINEXT_CF_ACCESS_TEAM_DOMAIN=off` and a redeploy). And a Cloudflare key outage becomes a console **outage**, not a fallback to the password form: FR-3306's "an unverifiable proof must not end a session" would have to be withdrawn. |
| **(b) Origin enforcement on the tunnel** | Cloudflare's "Protect with Access" on the tunnel's public hostname: `cloudflared` itself checks the Access token (team + AUD) before forwarding. | A console hostname whose Access application was deleted or loosened while the tunnel still routes it — the password form on the public internet. | A dashboard toggle; no code. **It does not close F4**: the Mailu network and loopback do not go through `cloudflared` at all. |
| **(c) Network** | Take the console off `mailu-network`. It only needs to *send* to `smtp:25`; nothing there needs to reach it. (c1) a minimal relay container on both networks forwarding `:25` to Mailu's `smtp:25`, the console on `default` only (postfix still sees a mailu-network address, so `permit_mynetworks` still authorises); or (c2) a `DOCKER-USER` iptables rule dropping `172.22.0.0/16` → the console's port. | The path that actually exists: a compromised neighbour container reaching the console. | (c1) one more container and a compose change, to be proven on the box (mail must still flow). (c2) firewall state outside the repo, on a co-tenant box, that must survive Docker restarts and the console's address changing — fragile. Neither closes loopback — which only matters to someone with a shell on the box, who already holds `deploy/.env` (the auth secret and database passwords), so it adds nothing they lack. |

**Recommendation: (c1), with (b) as a cheap independent guard.** (c1) removes the real exposure —
reach from a neighbour that does not pass Cloudflare — without changing any sign-in behaviour,
without touching break-glass, and without turning a Cloudflare outage into a console outage; (b)
costs one toggle and covers the different failure where Access itself is misconfigured. Keep (a) in
reserve: it is the strongest statement, but its price (a second switch, and FR-3306 withdrawn) is
only worth paying if the console ever has to share a network it cannot leave.

## Consequences

**An operator's email must be the address they prove to Access.** That is now the whole identity
model for the console, and it is checked by hand on the box (`deploy/TAKEOVER.md` §9.2). A founder
whose operator row carries a different address than the one they type into the PIN screen is
refused, visibly and on the record. It must also be plain ASCII (rule 1).

**Control of an operator's mailbox is control of the console (review F5).** Access emails a one-time
PIN; whoever can read that inbox passes Access as that operator and is then signed in as them, with
no password. That is **no weaker than before** — the password path's reset link goes to the same
mailbox (ADR-0013), so the mailbox already was the root of an operator's credential — but it is now
the *first* path rather than the recovery path, and so the Access application's own settings carry
the weight. Recommended, in the Zero Trust dashboard (and listed as a checklist in
`deploy/TAKEOVER.md` §9.4):

- **An explicit list of operator emails** in the Allow policy (*Include → Emails*). Never *Emails
  ending in* a domain — `gmail.com` would admit everyone — and never *Everyone*.
- **Application session duration 8–12 hours**, not the 24-hour default: the length of a working
  day, after which Access asks for a PIN again.
- **Binding cookie on**, so an Access token lifted from one browser is not accepted from another.
- **HttpOnly on, SameSite = Lax** for the Access cookie. Lax also means a cross-site image or frame
  carries no Access cookie and is stopped at Cloudflare's edge — a second wall behind rule 3's
  navigation check.
- **An identity provider with MFA** when feasible (Google with 2-Step Verification for the
  founders' accounts, or an MFA requirement on the policy) instead of the email PIN alone — the
  PIN is only as strong as the mailbox.

**The Access policy is now load-bearing twice.** It always decided who could reach the console
(FR-2208); it now also decides who the console believes they are. The operator row is still
required — Access admits, the row permits — so FR-2208's "in addition to, not instead of" holds.

**Recreating the Access application changes the AUD**, and Cloudflare sign-in stops until the
variable is updated — safely: it falls back to the password form and records each refused
assertion as `bad_audience`.

**The console fetches Cloudflare's keys at runtime**, so it needs outbound HTTPS. Without it, sign-in
by proof fails closed.

**The password path is now the less-used path**, and a less-used path is the one that rots. It keeps
its tests (`console-smoke.sh`, `session.test.mts`), and removing it is a decision Samuel owns.

**What would trigger revisiting.** The console being reached without Access in front of it (a
second hostname, a school's own staff): then (d), Cloudflare as an OIDC provider, or another
identity provider, replaces the header-borne assertion. Or Samuel removing the password fallback,
which would make the dev picker the only local path in and the Access proof the only deployed one.
