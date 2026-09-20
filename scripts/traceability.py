#!/usr/bin/env python3
"""Compute the requirements traceability matrix from the repository itself.

    ./scripts/traceability.py              # report
    ./scripts/traceability.py --check      # exit 1 on drift  (CI gate)
    ./scripts/traceability.py --write      # refresh the generated blocks

WHY THIS EXISTS. The traceability matrix was a hand-maintained document, and a
hand-maintained matrix decays silently. Two real examples from this repository,
both found by counting rather than reading: the requirement total read 76 when
71 were defined, and an entire deferred block (FR-701..707, billing) had no row
at all. Nothing was broken — the document simply stopped being true, and it is
the document the team is supposed to trust.

So the numbers are DERIVED. A requirement exists because a spec defines it; it
is traced because a row names it; it is covered because a test declares it. The
matrix reports the difference between those three sets, and `--check` fails when
they disagree. That turns "keep the doc updated" from a discipline into a build
error, which is the only version of it that survives contact with a deadline.

WHAT IT CANNOT DO. It checks that a requirement is CLAIMED to be verified, not
that the claim is true. Evidence is still prose written by whoever did the work,
and a row saying VERIFIED with a fabricated justification passes this tool. The
defence against that is review, not automation — which is worth stating plainly
rather than letting a green check imply more than it means.

THE TEST ANNOTATION. A test declares what it proves with a comment:

    // @covers FR-1213, FR-1214        (TypeScript)
    # @covers FR-904                   (Python)

Anywhere in the file. That is the whole convention — deliberately, because a
convention with a build step is one people stop following.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Each spec owns its own matrix. The baseline is FROZEN and shipped (ADR-0007):
# its requirements are as-built history, not work in flight, so it is reported
# but never gated — failing CI over a frozen spec would teach people to pass
# --no-verify, which costs more than the check is worth.
SPECS = [
    ("baseline", ROOT / "specs/000-baseline/spec.md",
     ROOT / "specs/000-baseline/traceability.md", False),
    ("mvp1", ROOT / "specs/001-student-mvp1-delta/spec.md",
     ROOT / "specs/001-student-mvp1-delta/traceability.md", True),
]
MATRIX = ROOT / "specs/001-student-mvp1-delta/traceability.md"
TASKS = ROOT / "specs/001-student-mvp1-delta/tasks.md"
TEST_GLOBS = ["app/src/**/*.test.mts", "services/**/test_*.py", "services/**/*_test.py"]

# A requirement is DEFINED by a bold marker in a spec: **FR-123**
DEF_RE = re.compile(r"\*\*(FR|SC)-(\d+)\*\*")

# and TRACED by a leading table cell. A row may name ONE requirement or a RANGE:
#
#     | FR-1213 | …
#     | FR-701…707 | …          (also ..  and  FR-701…FR-707)
#
# Ranges are not a workaround — seven deferred billing requirements sharing one
# reason read better as one row than as seven copies of "decisions.md Q7". The
# parser understands the document as written rather than making the document
# suit the parser, which is the only way a generated check stays welcome.
ROW_RE = re.compile(
    r"^\|\s*(FR|SC)-(\d+)\s*(?:(?:…|\.\.\.?|–|-)\s*(?:FR|SC)?-?(\d+))?\s*\|", re.M
)
STATUS_RE = re.compile(
    r"^\|\s*(FR|SC)-(\d+)\s*(?:(?:…|\.\.\.?|–|-)\s*(?:FR|SC)?-?(\d+))?\s*\|"
    r"[^|]*\|\s*\*{0,2}([A-Z]+)\*{0,2}", re.M
)


def expand(kind: str, lo: str, hi: str | None) -> list[str]:
    """`FR-701…707` -> FR-701 … FR-707. A range spanning more than 50 is almost
    certainly a typo rather than a real block, so it is not expanded."""
    a = int(lo)
    b = int(hi) if hi else a
    if b < a or b - a > 50:
        return [f"{kind}-{lo}"]
    # Keep the written width: FR-001 is not FR-1. Ids are matched as STRINGS
    # against the spec, so dropping a leading zero turns every three-digit
    # requirement into an orphan — which is exactly what it did the first time.
    width = len(lo)
    return [f"{kind}-{n:0{width}d}" for n in range(a, b + 1)]
TASK_RE = re.compile(r"^- \[([ xX])\]\s+(T\d{3})\b", re.M)
COVERS_RE = re.compile(r"@covers\s+([A-Z0-9,\-\s]+)")

# DROPPED is not DEFERRED. Deferred means "not now"; dropped means the
# requirement was withdrawn and will not return — FR-908 went that way when
# ADR-0010 released the comparison obligation. A dropped requirement keeps its
# row and its id forever, so the reason stays readable and the id is never reused.
VALID_STATUS = {"VERIFIED", "BUILT", "PARTIAL", "OPEN", "BLOCKED", "DEFERRED", "DROPPED"}


@dataclass
class Report:
    defined: dict[str, str] = field(default_factory=dict)      # id -> spec name
    traced: set[str] = field(default_factory=set)
    status: dict[str, str] = field(default_factory=dict)
    covered: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))
    tasks_done: set[str] = field(default_factory=set)
    tasks_open: set[str] = field(default_factory=set)

    def untraced_in(self, spec: str) -> list[str]:
        """Defined in this spec, named by no row. These are the silent ones."""
        return sorted(
            [r for r, s in self.defined.items() if s == spec and r not in self.traced],
            key=sort_key,
        )

    @property
    def untraced(self) -> list[str]:
        return sorted(set(self.defined) - self.traced, key=sort_key)

    @property
    def orphans(self) -> list[str]:
        """A row for a requirement no spec defines — usually a renumber that
        left the matrix behind."""
        return sorted(self.traced - set(self.defined), key=sort_key)

    @property
    def uncovered(self) -> list[str]:
        """Claimed VERIFIED with no test declaring it. Not automatically wrong —
        much of this product is verified by running it, and a browser session is
        real evidence — but it is the list worth looking at before anyone says
        'the requirements are tested'."""
        return sorted(
            [r for r, s in self.status.items() if s == "VERIFIED" and r not in self.covered],
            key=sort_key,
        )


def sort_key(rid: str) -> tuple:
    kind, num = rid.split("-")
    return (kind, int(num))


def scan() -> Report:
    rep = Report()

    for name, spec, matrix, _gated in SPECS:
        if spec.exists():
            for kind, num in DEF_RE.findall(spec.read_text()):
                rep.defined.setdefault(f"{kind}-{num}", name)
        if matrix.exists():
            text = matrix.read_text()
            for kind, lo, hi in ROW_RE.findall(text):
                rep.traced.update(expand(kind, lo, hi))
            for kind, lo, hi, status in STATUS_RE.findall(text):
                if status in VALID_STATUS:
                    for rid in expand(kind, lo, hi):
                        rep.status[rid] = status

    if TASKS.exists():
        for mark, tid in TASK_RE.findall(TASKS.read_text()):
            (rep.tasks_done if mark.lower() == "x" else rep.tasks_open).add(tid)

    for pattern in TEST_GLOBS:
        for path in ROOT.glob(pattern):
            if "node_modules" in str(path):
                continue
            rel = str(path.relative_to(ROOT))
            for blob in COVERS_RE.findall(path.read_text()):
                for rid in re.findall(r"(?:FR|SC)-\d+", blob):
                    rep.covered[rid].append(rel)
    return rep


def counts_block(rep: Report) -> str:
    """The counts for the GATED spec. This matrix belongs to one feature, so
    mixing the frozen baseline's requirements into its totals would make the
    headline number mean nothing in particular."""
    gated = {name for name, _s, _m, g in SPECS if g}
    owned = {r for r, sp in rep.defined.items() if sp in gated}
    by_status: dict[str, int] = defaultdict(int)
    for r in owned:
        if r in rep.status:
            by_status[rep.status[r]] += 1
    frs = [r for r in owned if r.startswith("FR-")]
    scs = [r for r in owned if r.startswith("SC-")]
    traced = len(owned & rep.traced)
    tested = len(owned & set(rep.covered))
    verified = by_status.get("VERIFIED", 0)
    verified_tested = len(
        [r for r in owned if rep.status.get(r) == "VERIFIED" and r in rep.covered]
    )
    other = sorted(n for n in rep.defined.values() if n not in gated)
    lines = [
        "<!-- GENERATED by scripts/traceability.py --write. Do not edit by hand:",
        "     the next run overwrites it. Change the spec or the rows instead. -->",
        "",
        "| | Count |",
        "|---|---|",
        f"| Functional requirements | **{len(frs)}** |",
        f"| Success criteria | **{len(scs)}** |",
        f"| Traced (every one needs a row) | **{traced} / {len(owned)}** |",
    ]
    for s_ in ("VERIFIED", "BUILT", "PARTIAL", "OPEN", "BLOCKED", "DEFERRED"):
        lines.append(f"| — {s_.lower()} | {by_status.get(s_, 0)} |")
    lines += [
        f"| Requirements a test declares | **{tested}** |",
        f"| Tasks complete / total | **{len(rep.tasks_done)} / {len(rep.tasks_done | rep.tasks_open)}** |",
        "",
        f"**Of {verified} requirements marked VERIFIED, {verified_tested} have an automated "
        f"test declaring them.** The remaining {verified - verified_tested} were verified by "
        "running the product — a browser session, a query against a loaded database — which is "
        "real evidence and is not re-checked on any later commit. That gap is the honest "
        "measure of this build's regression risk, and it is the number to drive down.",
        "",
        "Counted from the artifacts by `scripts/traceability.py`, which fails CI when the spec, "
        "the matrix and the tests disagree. The hand-maintained table this replaced had drifted "
        "five requirements out of date, and an entire deferred block had no row at all.",
    ]
    if other:
        lines.append("")
        lines.append(
            f"The frozen baseline (`specs/000-baseline/`) defines "
            f"{len([r for r, sp in rep.defined.items() if sp in other])} more requirements. It "
            "shipped and is not under change (ADR-0007), so it is reported by the tool but never "
            "gated — it has no matrix of its own yet."
        )
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit 1 on drift (CI gate)")
    ap.add_argument("--write", action="store_true", help="refresh the generated counts block")
    args = ap.parse_args()

    rep = scan()
    frs = [r for r in rep.defined if r.startswith("FR-")]

    print("REQUIREMENTS TRACEABILITY\n")
    print(f"  defined            {len(rep.defined):>4}   ({len(frs)} FR, {len(rep.defined) - len(frs)} SC)")
    print(f"  traced             {len(rep.traced & set(rep.defined)):>4}")
    print(f"  untraced           {len(rep.untraced):>4}   {'<-- drift' if rep.untraced else ''}")
    print(f"  orphan rows        {len(rep.orphans):>4}   {'<-- drift' if rep.orphans else ''}")
    print(f"  test-declared      {len(set(rep.covered) & set(rep.defined)):>4}")
    print(f"  tasks              {len(rep.tasks_done):>4} / {len(rep.tasks_done | rep.tasks_open)}")

    print()
    for name, spec, matrix, gated in SPECS:
        owned = [r for r, s in rep.defined.items() if s == name]
        missing = rep.untraced_in(name)
        tag = "GATED" if gated else "reported only (frozen)"
        state = "no matrix file" if not matrix.exists() else f"{len(owned) - len(missing)}/{len(owned)} traced"
        print(f"  {name:<10} {len(owned):>3} defined   {state:<22} [{tag}]")
        if missing:
            shown = ", ".join(missing)
            print(f"             untraced: {shown}")
    if rep.orphans:
        print("\n  ORPHANS — a row for a requirement no spec defines:")
        for r in rep.orphans:
            print(f"    {r}")

    verified = [r for r, s in rep.status.items() if s == "VERIFIED"]
    if verified:
        pct = 100 * (len(verified) - len(rep.uncovered)) // len(verified)
        print(f"\n  Of {len(verified)} VERIFIED requirements, {len(verified) - len(rep.uncovered)} "
              f"({pct}%) have a test declaring them.")
        print("  The rest were verified by running the product, which is real evidence")
        print("  but is not re-checked on every commit.")

    if args.write and MATRIX.exists():
        text = MATRIX.read_text()
        start = text.find("<!-- GENERATED: scripts/traceability.py")
        if start == -1:
            marker = "## 10. Counts"
            start = text.find(marker)
            if start == -1:
                print("\n  ! no '## 10. Counts' section to write into", file=sys.stderr)
                return 1
            start += len(marker) + 1
            end = text.find("\n## ", start)
            end = len(text) if end == -1 else end
        else:
            end = text.find("\n## ", start)
            end = len(text) if end == -1 else end
        text = text[:start] + "\n" + counts_block(rep) + "\n" + text[end:]
        MATRIX.write_text(text)
        print(f"\n  wrote the generated counts block into {MATRIX.relative_to(ROOT)}")

    if args.check:
        gated_missing = [r for name, _s, _m, g in SPECS if g for r in rep.untraced_in(name)]
        problems = len(gated_missing) + len(rep.orphans)
        if problems:
            print(f"\nFAIL: {problems} traceability drift(s) in a gated spec.\n"
                  f"  Every defined requirement needs a row. DEFERRED is a STATUS, not an\n"
                  f"  omission — a requirement nobody is building still has to say so, or the\n"
                  f"  matrix cannot be read as complete.",
                  file=sys.stderr)
            return 1
        print("\nOK: every requirement in a gated spec is traced, and no row is an orphan.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
