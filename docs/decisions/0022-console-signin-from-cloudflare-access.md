# ADR-0022 — Console sign-in from the Cloudflare Access identity

**Status**: Accepted — Samuel, 2026-09-24: *"the email verification is done through cloudflare, can you use this email from cloudflare"*
**Amends**: [ADR-0014](./0014-admin-console-second-build-target.md) — "Cloudflare Access proves you are on the invite list. The account and role prove you are permitted." Access now also proves **which** account. · `specs/002-identity-and-admin-console/contracts/auth.md` §Operator authentication (password becomes the fallback)
**Affects**: `app/src/lib/auth/cf-access.ts`, `operator-signin.ts`, `console-signin.ts`, `dev-picker.ts`, `principal.ts` · `app/src/app/api/auth/cloudflare/route.console.ts` · `app/src/app/api/auth/dev-operator/route.dev.console.ts` · `app/src/app/(auth)/signin/page.tsx` · `app/src/components/console/OperatorSessions.tsx` · `app/next.config.ts` · `app/scripts/check-surface-manifest.mts` · `deploy/docker-compose.mvp1.yml` · `.github/workflows/ci-cd.yml` · `scripts/local-dev.sh` · **FR-3301…FR-3312**
**Depends on**: [ADR-0013](./0013-student-accounts-and-sign-in.md) (the session model), [ADR-0014](./0014-admin-console-second-build-target.md) (the console build, and Access in front of it)

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
   and is refused.
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
   forwards a request carrying `cf`, so there is no loop.
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
   fallback usable if verification ever breaks.
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
   takes no password.
8. **Sign-out goes through Access.** Ending the console session alone would be undone by the very
   next request, which would carry a valid assertion straight back into a new session. With the
   feature on, the console's sign-out sends the browser to
   `https://reletix.cloudflareaccess.com/cdn-cgi/access/logout` after ending its own session.
9. **Password sign-in is kept, as the fallback.** It is not shown while a verified identity is
   present, and it is shown — with a one-line notice — when the assertion could not be verified.
   Samuel may remove it later; that is a separate decision.
10. **The team domain and the AUD are configuration, not code and not secrets.**
    `AINEXT_CF_ACCESS_TEAM_DOMAIN` and `AINEXT_CF_ACCESS_AUD`, on the console service only. CI writes
    them from repository *variables* with the production values as defaults; unset in the app means
    off. The AUD identifies an application; it authorises nothing without Cloudflare's signature.
11. **Locally, a dev operator picker — locked three times.** There is no Cloudflare in front of a
    laptop. `/signin` on the console lists "Sign in as <operator>" only when **all** of: `NODE_ENV`
    is not `production`; `AINEXT_DEV_OPERATOR_PICKER` is exactly `on`; the request is to localhost.
    The endpoint checks all three itself (hiding a button is not authorisation, FR-2107), and it is
    named `route.dev.console.ts`, a page extension `next.config.ts` adds only outside production — so
    `next build` does not compile it and `npm run check:surface:admin` fails if it ever appears.
    Picker sign-ins are recorded as `dev-picker:<roles>`.
12. **The student surface ignores all of it.** The route does not exist in the student build;
    `readAccessAssertion` answers null for the student surface without reading a header;
    `principal.ts` consults the proof only when `IS_CONSOLE`; neither variable is set on the
    student service.

## Consequences

**An operator's email must be the address they prove to Access.** That is now the whole identity
model for the console, and it is checked by hand on the box (`deploy/TAKEOVER.md` §9.2). A founder
whose operator row carries a different address than the one they type into the PIN screen is
refused, visibly and on the record.

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
