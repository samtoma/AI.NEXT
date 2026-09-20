/**
 * Outbound mail — two messages, two transports (research R4, ADR-0013).
 *
 * The product sends exactly two things: a verification link and a reset link.
 * Both are plain text, both are English (constitution v3.1.1 Principle V), and
 * neither carries a tracking pixel, a click-wrapped URL or an image. A minor's
 * mail client is not an analytics surface.
 *
 * **Locally the transport is `console`**: the link is printed to the server log
 * AND appended to a file under `app/.local-mail/`, so "sign up and verify" is a
 * two-command loop with no mail server to install and no shoulder-surfing of a
 * scrollback to find the link. On the box the transport is `smtp` against the
 * Mailu instance already running there — the same delivery path, host and
 * reputation Talent uses. A hosted provider would mean a minor's email address
 * crossing a border to a third-party processor, which R2 §A2 says needs a
 * licence and an adequacy assessment under PDPL.
 *
 * **The consequence is stated rather than discovered** (ADR-0013): mail that
 * does not arrive is an account that cannot be verified, with no support
 * channel behind it. Two mitigations are part of the design — verification
 * gates learning rather than signing in, and the resend is always available and
 * rate-limited rather than hidden behind a countdown.
 *
 * Configuration comes from `lib/env.ts` and nowhere else — including
 * `PUBLIC_URL`, which is never derived from the request host: a Host header is
 * client-controlled, and a verification link pointed at an attacker's origin is
 * a verification link that verifies for them.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { MAIL_FROM, MAIL_TRANSPORT, PUBLIC_URL, smtpUrl } from "@/lib/env";

export type MailMessage = { to: string; subject: string; text: string };

export function verificationLink(token: string): string {
  return `${PUBLIC_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
}

export function resetLink(token: string): string {
  return `${PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`;
}

export function verificationMail(to: string, link: string): MailMessage {
  return {
    to,
    subject: "Confirm your email for Noor",
    text: [
      "Hi,",
      "",
      "Confirm this email address and your Noor account is ready to learn with:",
      "",
      link,
      "",
      "The link works once and expires in 24 hours. If it has expired, ask for a",
      "new one from the sign-in page.",
      "",
      "If you did not create a Noor account, you can ignore this message — nothing",
      "happens until the link is used.",
      "",
      "— Noor",
    ].join("\n"),
  };
}

export function resetMail(to: string, link: string): MailMessage {
  return {
    to,
    subject: "Reset your Noor password",
    text: [
      "Hi,",
      "",
      "Someone asked to reset the password for this Noor account. If that was you,",
      "set a new one here:",
      "",
      link,
      "",
      "The link works once and expires in one hour. Using it signs you out",
      "everywhere, on purpose.",
      "",
      "If it was not you, no action is needed and your password has not changed.",
      "",
      "— Noor",
    ].join("\n"),
  };
}

const LOCAL_MAIL_DIR = ".local-mail";

/**
 * Send, or do the local equivalent.
 *
 * Never throws: every caller dispatches mail AFTER the response is committed,
 * inside its own error boundary, so that a delivery failure cannot change what
 * an endpoint answered (contracts/auth.md — `forgot-password` is always 202).
 */
export async function sendMail(message: MailMessage): Promise<void> {
  try {
    if (MAIL_TRANSPORT === "smtp") {
      await sendSmtp(message);
      return;
    }
    await sendConsole(message);
  } catch (err) {
    console.error(`[mail] failed to send "${message.subject}" to ${message.to}:`, err);
  }
}

async function sendConsole(message: MailMessage): Promise<void> {
  const stamp = new Date().toISOString();
  const rendered =
    `\n----- mail (${stamp}) -----\n` +
    `From: ${MAIL_FROM}\nTo: ${message.to}\nSubject: ${message.subject}\n\n` +
    `${message.text}\n----- end mail -----\n`;
  // Both, deliberately: the log is where you are already looking, the file is
  // what a test harness can read without scraping stdout.
  console.log(rendered);
  const dir = path.join(process.cwd(), LOCAL_MAIL_DIR);
  await mkdir(dir, { recursive: true });
  const safe = message.to.replace(/[^a-zA-Z0-9._@-]/g, "_");
  await appendFile(path.join(dir, `${safe}.txt`), rendered, "utf8");
}

async function sendSmtp(message: MailMessage): Promise<void> {
  // Imported here rather than at module load so the console path — the local
  // default and the one every test takes — never pulls nodemailer in.
  const nodemailer = await import("nodemailer");
  const tx = nodemailer.createTransport(smtpUrl());
  await tx.sendMail({
    from: MAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}
