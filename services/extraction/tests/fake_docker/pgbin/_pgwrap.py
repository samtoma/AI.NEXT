"""psql / pg_dump / pg_restore as the fake `db` container runs them (tests only; see ../docker).

Drops `-U <user>` (the box's owner role `ainext` need not exist on a test server; PGUSER, or
the OS user, is used), maps every `-d <database>` through the fake docker's map (so the stack's
`ainext_mvp1` can only ever mean the test's own database), then runs the real binary.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))


def real(tool: str) -> str:
    for d in os.environ.get("PATH", "").split(os.pathsep):
        p = Path(d) / tool
        if Path(d).resolve() != HERE and p.is_file() and os.access(p, os.X_OK):
            return str(p)
    sys.exit(f"fake docker: no real {tool} on PATH")


def main(tool: str, argv: list[str]) -> None:
    import importlib.machinery
    import importlib.util
    loader = importlib.machinery.SourceFileLoader("fake_docker", str(HERE.parent / "docker"))
    spec = importlib.util.spec_from_loader("fake_docker", loader)
    fd = importlib.util.module_from_spec(spec)
    loader.exec_module(fd)
    out, i = [], 0
    while i < len(argv):
        a = argv[i]
        if a == "-U":
            i += 2
            continue
        if a == "-d":
            out += ["-d", fd.map_db(argv[i + 1])]
            i += 2
            continue
        out.append(a)
        i += 1
    fd.log(tool, *out)
    os.execv(real(tool), [tool, *out])
