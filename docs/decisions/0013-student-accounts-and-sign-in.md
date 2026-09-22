# ADR-0013 — Student-owned accounts, parent-linkable, with Reletix-pattern sign-in

**Status**: Accepted — Samuel, 2026-09-20, in the identity & admin-console brainstorm (decisions D1, D9, D10)
**Amends**: [ADR-0007](./0007-student-mvp1-comparison-build.md) — the no-auth picker adopted at `specs/001-student-mvp1-delta/decisions.md` **Q5**, and the parent-by-the-same-dropdown answer at **Q11**
**Affects**: `FR-101`, `FR-102`, `FR-105`, `FR-106`, `FR-501`, `FR-604`, `FR-606` in `specs/001-student-mvp1-delta/spec.md` · `app/src/lib/student-context.ts` · `app/src/lib/demo-student.ts` · `FR-2001…FR-2099`, `FR-2901…FR-2999`
**Depends on**: [ADR-0012](./0012-per-student-isolation-rls.md)

## Context

Identity on `PDR1-0` is a picker. FR-101 says so in as many words — a dropdown
plus an in-place "create new user", no password, no verification, no session
credentials — and FR-102 forbids ever presenting it as a login, which
constitution v3.1.1 Principle VII also requires. That was the right call for
Q5's question ("how do pilot students get in?") when the answer had to be
*today*.

It has since become the blocker under three separate requirements:

- **FR-106** (self-signup with verification) is DEFERRED.
- **FR-604** (account-sharing deterrence) is DEFERRED, with the stated reason
  *"there are no accounts to share in this build"*.
- **FR-606** (per-person operator roles) is BLOCKED, explicitly on FR-106 —
  roles need accounts to attach to.

Three requirements, one missing thing. The new PRD and constitution v3.1.1
Principle VII already settle who owns the account: the student, with the parent
as a linked view rather than the account holder.

## Options considered

**Ownership — parent-owned account with child profiles.** Matches how the
product is sold and who pays for it, and is the shape most Egyptian families
would expect. Rejected on two grounds: the PRD and constitution v3.1.1 VII both
place ownership with the student, and multi-child parent accounts are a binding
MVP non-goal (VIII) — a profile-per-child model is that non-goal wearing a
different name.

**Ownership — student-owned, parent-linkable.** Chosen. The account is the
student's; a parent is a link to it, not a holder of it.

**Credential — email + password only.** Familiar, self-contained, no third
party. A fourteen-year-old may not have an email address of their own.

**Credential — Google OAuth.** Removes the password and its reset path
entirely, and R1 §2 documents a clean upsert-by-email rule worth reusing. Adds a
third party to the sign-in path and still assumes an email account.

**Credential — phone + OTP.** In Egypt the phone number is the near-universal
identifier, and it is the one a parent would supply. It needs an SMS provider
and a per-message cost, and it is the largest build of the three.

**Chosen: email + password and Google now, phone + OTP designed into the same
session model and built later.** R1 §9 is what makes the deferral safe: a
session row does not care *how* a login happened, only that it did, so adding
OTP later slots into the existing session path without a schema change.

## Decision

**`accounts` carries the credential; `students` stays the learning record;
`students.account_id` joins them.**

The separation is deliberate rather than tidy. The learning record is the thing
RLS protects and an operator replays; the credential is the thing that gets
verified, throttled, locked, rotated and deleted. They have different lifetimes
and different blast radii, and merging them would mean a password reset touching
the table mastery is written to.

- `accounts`: credential material, verification state, account status, lockout
  state.
- **One account ↔ one student in this release.**
- A `guardians` link is **modelled and migrated, not built** — no parent login,
  no parent view, no invitation flow (constitution v3.1.1 VIII holds; `FR-2901…`
  records it as architecture-only).

**Sign-in mirrors Talent's flows**, which R1 read end to end: signup, email
verification, login, refresh with rotation, logout and logout-all, a session
list the owner can revoke from, forgot/reset password, and a Google
upsert-by-email that *links* an existing password account instead of erroring on
it. Case-insensitive email is enforced by a functional unique index in the
database as well as in the application (R1 §1) — a raw INSERT must not be able to
create a case-variant duplicate.

**Two departures from that pattern, recorded as deliberate.** Both exist because
R1 checked the code rather than the architecture document, and found the
document describing a system that is not there.

1. **Both tokens live in HttpOnly cookies.** Talent puts only the refresh token
   in one; the access token is returned in the JSON body and kept by the SPA in
   `localStorage`, attached by a client-side Bearer interceptor (R1 §1, §4b-1).
   Any script injection reads it. Next.js route handlers read an HttpOnly cookie
   server-side, so there is no architectural reason to put the access token
   anywhere a client script can reach. Access token short-lived, refresh token
   path-scoped and rotating. An OAuth login ends at the same session-creation
   path as a password login — never with a token in a redirect URL, which is
   Talent's other live gap (R1 §2).

2. **One authorisation seam, and auth events that actually fire.**
   `SECURITY_ARCHITECTURE.md` asserts a `require_role(...)` dependency that does
   not exist in Talent's code (R1 §3); four of its seven named security events
   are defined, unit-tested and never emitted, and there is no lockout anywhere
   to emit `account_locked` from (R1 §5). AI.NEXT gets a single server-side
   guard that every protected route goes through, failed-login throttling with
   lockout, and a test per named event asserting it fires. Defining an event is
   not emitting it, and a document describing a guard is not a guard.

**Gender is collected at signup** (D10). The tutor currently assumes every
student is a boy, and at a scale the original finding understated: R3 counted
**63 masculine pronouns (+1 `himself`) in `app/src/lib/lesson.ts`, 21 in
`ask.ts` and 11 in `checkin.ts`** — against the 23 cited in traceability §9
(seams §8). The purpose and the limit belong here, because this is where
the limit binds: gender addresses the student correctly and adjusts the tutor's
voice. It **MUST NOT** gate content, **MUST NOT** change difficulty or question
selection, and **MUST NOT** leave the first-party store — the anonymous GA
stream never carries it. The enumeration of values, and whether it is skippable,
are the plan's to fix in `data-model.md`; the limit above is not the plan's to
move.

**No disclosure screen at signup** — Samuel, D7, his decision and his
responsibility. It is bounded and reversible: the audience is an invited pilot
behind Cloudflare Access, and revisiting it is a condition of any wider
audience, not an option. Gender is a new datum measured against constitution
VII's minimalism, so an amendment is *drafted as a proposal* in
`specs/002-identity-and-admin-console/constitution-amendment-proposal.md` for
Samuel to approve. This ADR does not amend the constitution.

**Cloudflare Access stays in front of the pilot** (constitution v3.1.1 III,
FR-907) in addition to accounts. An account is not a substitute for the invite list this
release; it is a second layer behind it.

## Consequences

**The picker is retired on `PDR1-0` and kept on `family-tutor`.** ADR-0010 makes
that legitimate — the two solutions may diverge completely, and the frozen
baseline keeps the identity model it shipped with.

**`resolveStudentId()` changes meaning.** It stops being "the cookie's student,
validated against a table" and becomes "the authenticated principal" — and it is
the same value ADR-0012 sets on the connection for the request. The
default-student fallback in `app/src/lib/demo-student.ts` becomes a 401. A
function that must never throw becomes a function that must refuse.

**FR-105 becomes moot.** "Remember the last selected student across visits" has
no meaning when an account has one student. It is marked superseded, not dropped
as wrong — it was correct for the build it was written for.

**FR-501's accepted limitation closes by construction.** *"Any pilot parent can
therefore see any pilot student's data"* was true because the parent used the
students' own dropdown. With per-student isolation and no parent login it cannot
be true. The limitation that replaces it is the parent view's absence, which is
a smaller one and a scheduled one.

**FR-604 stops being deferred for lack of accounts.** The session list and
revoke are the deterrent; the requirement can be reopened against them.

**FR-606 unblocks** — the roles it asks for are ADR-0014's.

**Cost, stated plainly.** Outbound email delivery (a provider, a sending domain,
a reputation to maintain), a Google OAuth client, and a set of secrets on the
box. None of this existed before, and `deploy/docker-compose.mvp1.yml` gains
environment it has never carried. Email that does not arrive is an account that
cannot be verified, which is a support load with no support channel behind it.

**What would trigger revisiting.** A cohort of students with no email addresses
— a school intake, most likely. That is the case phone + OTP exists for, and
because it is designed into the session model now, the answer is a build rather
than a redesign.
