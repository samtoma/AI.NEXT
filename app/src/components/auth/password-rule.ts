/**
 * The one number the forms need from the password policy — and nothing else.
 *
 * `lib/auth/password.ts` is where `MIN_PASSWORD_LENGTH` really lives, but that
 * module imports `@node-rs/argon2` and computes a real Argon2id dummy hash at
 * module load. Importing it from a client component would pull a native
 * addon into the browser bundle (it would not build) and would put the hasher
 * one import away from code that has seen a plaintext password. A duplicated
 * integer is the cheap side of that trade.
 *
 * If the server rule moves, this is the second line to change — and the server
 * is still the one that decides: the input's `minLength` is a courtesy, the
 * 422 is the rule.
 */
export const MIN_PASSWORD_LENGTH = 8;
