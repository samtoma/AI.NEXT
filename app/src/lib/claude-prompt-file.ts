import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A `claude -p` call's system prompt, in a private temporary FILE — never on the command line.
 *
 * ---------------------------------------------------------------------------
 * WHY (the incident of 2026-10-12)
 * ---------------------------------------------------------------------------
 * Linux refuses any SINGLE exec argument longer than MAX_ARG_STRLEN (32 pages,
 * 131,072 bytes) with E2BIG, and the process never starts — whatever ARG_MAX
 * (the total, 2 MB on the box) says. The tutor passed its whole system prompt,
 * data block included, as `--system-prompt <text>`. Every Prep-3 lesson stayed
 * under the limit (the largest, 99 KB); 8 of the Grade 10 book's 65 lessons did
 * not (the largest, lesson 6.5, 211,529 bytes), and the first one a Grade 10
 * student opens (1.3) is among them. On the box every such turn failed with
 * `spawn E2BIG` and the student read "AI backend unavailable" — with the CLI
 * signed in and healthy. macOS has no per-argument limit, so it never showed
 * on a Mac.
 *
 * `--system-prompt-file` carries the same text with no size limit (proved on
 * the box with a 164 KB prompt, CLI 2.1.293). The file is mode 0600 in a
 * directory only this process can read (`mkdtemp` makes it 0700), and it lives
 * for one call: `dispose()` removes it, and is safe to call more than once.
 *
 * Kept out of `lib/claude-cli.ts` on purpose: that module is pure (no
 * filesystem, no child process) so its classifier can be tested without a
 * runtime.
 */
export type SystemPromptFile = { path: string; dispose: () => void };

export function systemPromptFile(text: string): SystemPromptFile {
  const dir = mkdtempSync(join(tmpdir(), "ainext-sysprompt-"));
  const path = join(dir, "system.txt");
  writeFileSync(path, text, { mode: 0o600 });
  let disposed = false;
  return {
    path,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort: /tmp is the container's own, and a leftover is one file
      }
    },
  };
}
