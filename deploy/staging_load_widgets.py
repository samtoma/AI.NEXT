"""Load a book's widget questions on STAGING, leaving out widgets whose parent book question is not in the book.

    python /repo/deploy/staging_load_widgets.py <widget-questions.json> --skip-parent <question id> [...] -- <loader args>

Run in the staging loader container (cwd services/extraction), from deploy-staging.yml. It writes the bundle minus
the named widgets to /tmp (the repo is mounted read-only) and runs load_generated_questions.py on that copy with the
loader args unchanged.

Why it exists (Tamer, 2026-10-25): prep3-parallel's think-and-discuss 3 became a plotting widget (6c406378) and its
text question was held; a later compile of Unit 1 left the held question out of pp3u1.json, so on a fresh database
the widget names a parent that is not there and the loader refuses the whole file. Staging skips that one widget.
The real fix is in the book's data; when it lands, drop the --skip-parent from the workflow and this script with it.
A skipped id whose parent IS in the bundle file is an error, so a stale skip cannot go on hiding a good widget.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def main() -> int:
    argv = sys.argv[1:]
    loader_args = argv[argv.index("--") + 1:] if "--" in argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("bundle", type=Path)
    ap.add_argument("--skip-parent", action="append", default=[])
    a = ap.parse_args(argv[: argv.index("--")] if "--" in argv else argv)

    data = json.loads(a.bundle.read_text())
    skip = set(a.skip_parent)
    # the book itself: the compiled bundles (they carry "nodes"), not the generated files beside them
    texts = (p.read_text() for p in a.bundle.parent.glob("*.json"))
    book = "".join(t for t in texts if '"nodes"' in t[:2000])
    stale = sorted(s for s in skip if f'"{s}"' in book)
    if stale:
        print(f"refusing: these parents are in the book now, so nothing should be skipped: {stale}", file=sys.stderr)
        return 1
    before = data["questions"]
    data["questions"] = [q for q in before if q.get("parent_question_id") not in skip]
    out = Path("/tmp") / a.bundle.name
    out.write_text(json.dumps(data))
    print(f"{a.bundle}: {len(before)} -> {len(data['questions'])} widgets (skipped parents {sorted(skip)})")
    return subprocess.call([sys.executable, "load_generated_questions.py", str(out), *loader_args])


if __name__ == "__main__":
    sys.exit(main())
