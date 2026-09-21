/**
 * Cookie names, by surface — the one fact `cookies.ts` (imported by routes and
 * `principal.ts`) and `proxy.ts` (which must import nothing with a database
 * behind it, per Next's own guidance — see that file's header) both need to
 * agree on, so it lives in a module that imports NOTHING and can be required
 * from either without pulling in the other's world.
 *
 * **F-P2b.** Before this, both surfaces used the same two names (`ainext_at`,
 * `ainext_rt`). `localhost` cookies are not scoped by port, so a student
 * signed in on the student build at `:3000` and an operator signed in on the
 * console at `:3002` were, on one laptop, writing into the SAME cookie jar
 * under the SAME names — whichever surface signed in last held the cookie,
 * and the console's own `POST /api/auth/refresh` had no way to tell a
 * student's token from an operator's before rotating it. Separate names make
 * that collision structurally impossible even before any server-side check
 * runs: the console never has an `ainext_rt` to misread, because it was never
 * the cookie the console's own sign-in wrote.
 *
 * On the deployed box the two surfaces will have different hostnames, where
 * this is belt-and-braces rather than load-bearing — but the box is not where
 * this bug was found, and a fix that only works once hostnames differ is a
 * fix that leaves every local dev setup (and any future same-host deploy)
 * exposed. Locally, with both surfaces on `localhost` at different ports,
 * this is the ONLY thing keeping the two cookie jars apart.
 */

export type Surface = "student" | "admin";

export type CookieNames = {
  access: string;
  refresh: string;
};

const STUDENT_COOKIES: CookieNames = { access: "ainext_at", refresh: "ainext_rt" };
const CONSOLE_COOKIES: CookieNames = { access: "ainext_cat", refresh: "ainext_crt" };

/** Pure lookup — no environment, no I/O, so both consumers get the same answer. */
export function cookieNames(surface: Surface): CookieNames {
  return surface === "admin" ? CONSOLE_COOKIES : STUDENT_COOKIES;
}
