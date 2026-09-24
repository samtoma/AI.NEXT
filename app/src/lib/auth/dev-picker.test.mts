/**
 * @covers FR-3309
 *
 * The local-development operator picker signs somebody in as ANY operator with
 * no credential, so the tests here are all refusals but one.
 *
 * Three locks, each proven to hold on its own — production, the flag, the
 * host — then the limit of the third stated as a test (headers are not proof;
 * the loopback bind is, and both launchers are checked for it), and then the
 * production BUILD proven not to contain the endpoint:
 * `next.config.ts` is evaluated in a child process under each `NODE_ENV` and
 * its page extensions compared, and the endpoint's file name is asserted to be
 * the one those extensions exclude. `npm run check:surface:admin` then asserts
 * the same thing against the real route manifest of a real `next build`.
 */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { devPickerDecision, devPickerDecisionFor } from "./dev-picker.ts";

const OPEN = {
  nodeEnv: "development",
  flag: "on",
  host: "localhost:3002",
  origin: "http://localhost:3002",
  forwardedFor: "::1",
};

test("all three locks open: allowed (and only then)", () => {
  assert.deepEqual(devPickerDecision(OPEN), { allowed: true });
  assert.deepEqual(devPickerDecision({ ...OPEN, host: "127.0.0.1:3002", origin: null, forwardedFor: "127.0.0.1" }), {
    allowed: true,
  });
  assert.deepEqual(devPickerDecision({ ...OPEN, host: "[::1]:3002", origin: "http://[::1]:3002" }), { allowed: true });
});

test("refused when NODE_ENV is production — whatever else is true", () => {
  assert.deepEqual(devPickerDecision({ ...OPEN, nodeEnv: "production" }), { allowed: false, why: "production" });
});

test("refused when the flag is off, absent, or anything but exactly 'on'", () => {
  for (const flag of [undefined, "", "off", "ON", "true", "1", "yes", " on"]) {
    assert.deepEqual(devPickerDecision({ ...OPEN, flag }), { allowed: false, why: "flag_off" }, String(flag));
  }
});

test("refused when the host is not local — the tailnet, the LAN, a real hostname, or none", () => {
  for (const host of [
    "admin-noor.reletix.com",
    "samuels-mac.tail1234.ts.net:3002",
    "192.168.1.20:3002",
    "10.0.0.5",
    "localhost.evil.example",
    "127.0.0.1.nip.io:3002",
    "",
    null,
    undefined,
  ]) {
    assert.deepEqual(
      devPickerDecision({ ...OPEN, host, origin: null, forwardedFor: null }),
      { allowed: false, why: "not_local_host" },
      String(host)
    );
  }
});

test("refused when a local Host header arrives with a foreign Origin (a cross-site form post)", () => {
  assert.deepEqual(devPickerDecision({ ...OPEN, origin: "https://evil.example" }), {
    allowed: false,
    why: "not_local_origin",
  });
});

test("refused when the Origin is `null` — a sandboxed frame, a data: or file: page, a redirect chain", () => {
  for (const origin of ["null", "NULL", " null "]) {
    assert.deepEqual(
      devPickerDecision({ ...OPEN, origin }),
      { allowed: false, why: "null_origin" },
      JSON.stringify(origin)
    );
  }
  // An Origin header that is present but empty is no real browser's either.
  assert.deepEqual(devPickerDecision({ ...OPEN, origin: "" }), { allowed: false, why: "not_local_origin" });
  // Absent (a same-origin GET, curl on the laptop) is not the same as `null`.
  assert.deepEqual(devPickerDecision({ ...OPEN, origin: null }), { allowed: true });
  assert.deepEqual(devPickerDecision({ ...OPEN, origin: undefined }), { allowed: true });
});

test("the header checks are NOT proof: a forged Host + X-Forwarded-For passes them — the bind is the lock", () => {
  // What a machine on the same Wi-Fi can send to a dev server that listens on
  // every interface. Stated as a passing test so nobody reads lock 3 as more
  // than it is; the next test is what makes it hold.
  assert.deepEqual(
    devPickerDecision({ ...OPEN, host: "localhost:3002", origin: null, forwardedFor: "127.0.0.1" }),
    { allowed: true }
  );
});

test("both ways of starting the console locally bind it to 127.0.0.1", () => {
  const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
  const script = readFileSync(ROOT + "scripts/local-dev.sh", "utf8");
  const serveAdmin = script.slice(script.indexOf("serve_admin()"), script.indexOf("\nif [ \"$SERVE\" = 1 ]"));
  assert.match(serveAdmin, /npm run dev -- -H 127\.0\.0\.1/, "local-dev.sh serve_admin binds loopback when the picker is set");
  const launch = JSON.parse(readFileSync(ROOT + ".claude/launch.json", "utf8")) as {
    configurations: { name: string; runtimeArgs?: string[]; env?: Record<string, string> }[];
  };
  const consoles = launch.configurations.filter((c) => c.env?.AINEXT_SURFACE === "admin");
  assert.ok(consoles.length > 0, "launch.json has a console entry");
  for (const c of consoles) {
    const args = c.runtimeArgs ?? [];
    const i = args.findIndex((a) => a === "-H" || a === "--hostname");
    assert.ok(i >= 0 && args[i + 1] === "127.0.0.1", `${c.name}: ${args.join(" ")}`);
  }
});

test("refused when Next recorded a non-loopback client address", () => {
  assert.deepEqual(devPickerDecision({ ...OPEN, forwardedFor: "192.168.1.44" }), {
    allowed: false,
    why: "not_local_client",
  });
});

test("the request-reading form reads the real process: this test runner is not 'on'", () => {
  const saved = process.env.AINEXT_DEV_OPERATOR_PICKER;
  delete process.env.AINEXT_DEV_OPERATOR_PICKER;
  try {
    const h = new Headers({ host: "localhost:3002" });
    assert.deepEqual(devPickerDecisionFor(h), { allowed: false, why: "flag_off" });
  } finally {
    if (saved !== undefined) process.env.AINEXT_DEV_OPERATOR_PICKER = saved;
  }
});

// ---------------------------------------------------------------- the build

const APP = fileURLToPath(new URL("../../..", import.meta.url));

function pageExtensions(nodeEnv: "production" | "development", surface: string): string[] {
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import('./next.config.ts'); process.stdout.write(JSON.stringify(m.default.pageExtensions));",
    ],
    {
      cwd: APP,
      env: { ...process.env, NODE_ENV: nodeEnv, AINEXT_SURFACE: surface, NODE_NO_WARNINGS: "1" },
      encoding: "utf8",
    }
  );
  return JSON.parse(out) as string[];
}

test("the endpoint's file is named with the dev-only extension, and nothing else answers that address", () => {
  const route = "src/app/api/auth/dev-operator/route.dev.console.ts";
  assert.ok(existsSync(APP + route), route);
  for (const other of ["route.ts", "route.console.ts", "route.student.ts"]) {
    assert.ok(!existsSync(APP + `src/app/api/auth/dev-operator/${other}`), `no ${other} beside it`);
  }
});

test("a PRODUCTION console build does not treat `.dev.console.ts` as a route; a dev server does", () => {
  const prod = pageExtensions("production", "admin");
  assert.ok(!prod.includes("dev.console.ts"), `production: ${prod.join(", ")}`);
  const dev = pageExtensions("development", "admin");
  assert.ok(dev.includes("dev.console.ts"), `development: ${dev.join(", ")}`);
});

test("the student build never treats `.dev.console.ts` (or any console file) as a route", () => {
  for (const env of ["production", "development"] as const) {
    const exts = pageExtensions(env, "student");
    assert.ok(!exts.some((e) => e.includes("console")), `${env}: ${exts.join(", ")}`);
  }
});
