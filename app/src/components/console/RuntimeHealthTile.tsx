import { Chip, stamp } from "@/components/console/ui";
import { CLI_CODE_ACTION, CLI_CODE_LABEL, type CliCode } from "@/lib/claude-cli";
import {
  healthLines,
  type HealthThresholds,
  type RuntimeVerdict,
} from "@/lib/runtime-health";

/**
 * **The AI runtime** (FR-3007…FR-3010) — the tile that would have caught the
 * incident of 2026-09-22.
 *
 * The tutor runs on Samuel's Claude subscription through the bundled `claude`
 * CLI. On the live box that sign-in silently expired and nothing noticed: the
 * container had been up seven weeks, and for an unknown part of that the
 * product signed students in, showed them their lessons and their progress,
 * and failed every single tutor turn. Nothing in the product detected it —
 * precisely because everything else kept working.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS, NEVER COLLAPSED INTO ONE
 * ---------------------------------------------------------------------------
 *  1. **The probe's verdict AND its age**, in the same breath, always. A probe
 *     that last ran two hours ago is `unknown` — not a slightly weaker `ok` —
 *     and it is drawn differently from both of the other two states.
 *     **Silence is not health**, and a tile that says "nobody has looked" is
 *     the one thing this feature exists to put on a screen.
 *  2. **The passive signal** — what real turns actually did — so a live
 *     failure shows even when the probe has not run. Its weakness is printed
 *     beside it, because "no turns, none failed" is not health and a quiet
 *     night must never be able to look like one.
 *  3. **What is still working**, in plain words. "The tutor is down" reads as
 *     "everything is down", which is wrong and would cause the wrong response
 *     at 9pm — somebody would start rolling back a deployment that is fine.
 *
 * And it names **who can fix it**: only Samuel, because the sign-in is
 * interactive and needs a terminal. `deploy/TAKEOVER.md` §5 is referenced
 * rather than copied — a runbook duplicated into a page is a runbook with two
 * versions, and the one on the screen is the one that goes stale.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE OWNS NO WORDS
 * ---------------------------------------------------------------------------
 * Every sentence comes from `healthLines()` in `lib/runtime-health.ts`. The
 * wording IS the requirement, and `.tsx` cannot be loaded by `node --test`
 * (no JSX transform), so copy that lived here could only ever be checked by
 * opening a browser — which was not available while this was written. What is
 * here is structure, emphasis and tokens; what is asserted in
 * `runtime-health.test.mts` is what an operator actually reads.
 *
 * ---------------------------------------------------------------------------
 * TOKENS ONLY (constitution XII), AND THREE TREATMENTS FOR THREE STATES
 * ---------------------------------------------------------------------------
 * No literal colour, stroke width, radius or shadow. Gold is the console's
 * "look here" colour and carries the failure, as it does on the cross-student
 * banner; the dashed line on the plain surface is the grammar `/overview`
 * already uses for "no data", which is exactly what `unknown` means. And the
 * **word is always present** — the colour is a second signal, never the only
 * one, so the state survives a greyscale print and a colourblind reader.
 *
 * Its props are a verdict and four numbers, never the whole `SecurityView`, so
 * it cannot reach a student's name, an IP or a sign-in event even by accident.
 */
export function RuntimeHealthTile({
  runtime,
  thresholds,
}: {
  runtime: RuntimeVerdict;
  thresholds: HealthThresholds;
}) {
  const state = runtime.state;
  const line = healthLines(
    runtime,
    thresholds,
    stamp,
    (code) => CLI_CODE_LABEL[code as CliCode] ?? code,
    (code) => CLI_CODE_ACTION[code as CliCode] ?? ""
  );

  const skin =
    state === "failing"
      ? "border-gold bg-gold-wash"
      : state === "unknown"
        ? "border-dashed border-line bg-paper-deep"
        : "border-line bg-card";

  return (
    <section className={`mt-5 rounded-lg border px-4 py-3.5 ${skin}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
          The AI tutor
        </h2>
        <Chip tone={state === "ok" ? "good" : state === "failing" ? "attention" : "neutral"}>
          {line.word}
        </Chip>
      </div>

      {/* 1 — the probe's verdict AND its age. Never one without the other. */}
      <p className="mt-2 text-[13px] leading-relaxed text-ink">
        <strong>{line.probeLead}</strong> {line.probeRest}
      </p>

      {/* 2 — what real turns actually did. */}
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{line.turns}</p>

      {/* 3 — what still works. The sentence that stops the wrong panic. */}
      <p className="mt-2 border-t border-line-soft pt-2 text-[12.5px] leading-relaxed text-ink-soft">
        <strong>{line.stillWorkingLead}</strong> {line.stillWorking}
      </p>

      {line.whoFixes ? (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{line.whoFixes}</p>
      ) : null}

      <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-faint">
        {line.provenance}
      </p>
    </section>
  );
}
