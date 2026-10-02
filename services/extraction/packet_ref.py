"""Packet by reference: a workflow's big input written to files, and compact args that name them.

WHY. A runbook workflow receives everything as the Workflow tool's `args`, and the operating session
types those args into a tool call. A chapter's packet is 60–200 KB: far too much to type. A
workflow script cannot read a file (no fs, no Node APIs), but the agents it starts can. So each
builder can write the packet's big text to SHARD files and give the workflow compact args: only what
the script's control flow needs (ids, counts, partitions, options, hashes) plus the shard directory.
Each prompt then shows `[[file: <path>]]` where the text used to be, and tells the agent to read it.

S0b did this first (`assemble_maths.py vision-args --batch-dir`); this module is the shared part for
S1, S5 (draft), S6 and S7. The flag is the same everywhere: `--by-ref [DIR]`, default
`work/<book>/packets/<stage>-<tag>/` (gitignored: derived, regenerable).

THE RULES a shard obeys (tests/test_packet_ref.py proves them per stage):
  * one shard per unit of agent work, holding EXACTLY the text that unit's prompt used to carry
    inline — so splicing every shard back into the by-ref prompt gives the inline prompt again,
    except that the inline "do not read any file" sentence becomes READ_RULE;
  * a shard never holds what the agent that reads it is meant to be blind to (a finder's shard
    has no other finder's output, a blind solver's shard no key, a widget verifier's no spec);
  * compact args stay under COMPACT_LIMIT bytes (the builder warns above it).

Rendering: the shards are the workflow's OWN renderings, re-implemented here (`js_*` below mimic
JavaScript's template interpolation, JSON.stringify and UTF-16 string slicing). The splice test
runs both and compares byte for byte, so the two cannot drift silently.

INTEGRITY. Every by-ref args carries `by_ref: {dir, stage, shards_sha256, files}`; the workflow
echoes it in its return value. `shards_sha256` is the hash of the shard set (names and contents);
`manifest.json` in the directory lists every file's own hash. An assembler that can rebuild the
packet (S1) re-renders the shards and checks the echoed hash, so a run is tied to the exact files
it was told to read.
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent

# The sentence every by-ref prompt carries, word for word in each runbook/*.workflow.js.
READ_RULE = ("Parts of this message are kept in files: wherever it shows [[file: <path>]], read that file "
             "with the Read tool (read them all in one turn); its whole content belongs in that place. "
             "Those files are the only files you may open.")
FILE_TOKEN = "[[file: {path}]]"
COMPACT_LIMIT = 15_000


def default_dir(book: str, stage: str, tag: str) -> Path:
    return HERE / "work" / book / "packets" / f"{stage}-{tag}"


def dumps(args: dict) -> str:
    """By-ref args as the builders write them: one line, no padding — the text the operator pastes."""
    return json.dumps(args, ensure_ascii=False, separators=(",", ":"))


def args_size(args: dict) -> int:
    """The size the operator types: the args as JSON (UTF-8 bytes)."""
    return len(json.dumps(args, ensure_ascii=False).encode())


# ---------------------------------------------------------------- JavaScript-exact rendering
def js_truthy(v) -> bool:
    """JavaScript truthiness: every array and object is truthy; 0, '', null, false are not."""
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0 and not (isinstance(v, float) and math.isnan(v))
    if isinstance(v, str):
        return v != ""
    return True


def js_or(*vs):
    """`a || b || c`."""
    for v in vs[:-1]:
        if js_truthy(v):
            return v
    return vs[-1]


def js_number(x) -> str:
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, int):
        return str(x)
    if math.isnan(x) or math.isinf(x):
        return "NaN" if math.isnan(x) else ("Infinity" if x > 0 else "-Infinity")
    if x == int(x) and abs(x) < 2 ** 53:
        return str(int(x))
    r = repr(x)                                      # shortest round-trip digits, as JavaScript's
    if "e" not in r:
        return r
    mant, exp = r.split("e")
    e = int(exp)
    if -7 < e < 21:                                  # JavaScript prints these without an exponent
        from decimal import Decimal
        return format(Decimal(r), "f")
    return f"{mant}e{'+' if e > 0 else '-'}{abs(e)}"


def js(v) -> str:
    """`${v}` in a template literal."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return js_number(v)
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ",".join("" if x is None else js(x) for x in v)
    return "[object Object]"


def js_len(s: str) -> int:
    """`s.length`: UTF-16 code units."""
    return len(s.encode("utf-16-le")) // 2


def js_slice(s: str, n: int) -> str:
    """`s.slice(0, n)` in UTF-16 code units (a split surrogate pair is dropped, not half-kept)."""
    if js_len(s) <= n:
        return s
    return s.encode("utf-16-le")[: 2 * n].decode("utf-16-le", errors="ignore")


def js_json(v, indent: int | None = None, _level: int = 0) -> str:
    """`JSON.stringify(v, null, indent)` (indent None: compact)."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return "null" if isinstance(v, float) and (math.isnan(v) or math.isinf(v)) else js_number(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    pad, inner = ("", "") if indent is None else ("\n" + " " * (indent * _level), "\n" + " " * (indent * (_level + 1)))
    if isinstance(v, (list, tuple)):
        if not v:
            return "[]"
        parts = [js_json(x, indent, _level + 1) for x in v]
        return "[" + (",".join(parts) if indent is None else inner + ("," + inner).join(parts) + pad) + "]"
    if isinstance(v, dict):
        if not v:
            return "{}"
        sep = ":" if indent is None else ": "
        parts = [json.dumps(str(k), ensure_ascii=False) + sep + js_json(x, indent, _level + 1) for k, x in v.items()]
        return "{" + (",".join(parts) if indent is None else inner + ("," + inner).join(parts) + pad) + "}"
    raise TypeError(f"not JSON: {type(v)}")


def js_clip(v, n: int) -> str:
    """The workflows' `clip(v, n)`: JSON.stringify(v, null, 1).slice(0, n)."""
    return js_slice(js_json(v, 1), n)


# ---------------------------------------------------------------- the shard set
def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


class Shards:
    """A fresh shard directory. `put(name, text)` writes one shard; `finish()` writes the
    manifest and returns the `by_ref` block the compact args carry."""

    def __init__(self, directory: Path, stage: str):
        self.dir = Path(directory).resolve()
        self.stage = stage
        if self.dir.exists():
            shutil.rmtree(self.dir)                 # never mix two builds' shards
        self.dir.mkdir(parents=True)
        self.files: dict[str, str] = {}

    def put(self, name: str, text: str) -> str:
        if name in self.files:
            raise ValueError(f"shard {name} written twice")
        p = self.dir / name
        p.parent.mkdir(parents=True, exist_ok=True)
        data = text.encode()
        p.write_bytes(data)
        self.files[name] = _sha(data)
        return name

    def path(self, name: str) -> str:
        return str(self.dir / name)

    def finish(self, extra: dict | None = None) -> dict:
        ref = {"dir": str(self.dir), "stage": self.stage, "shards_sha256": shards_sha256(self.files),
               "files": len(self.files)}
        (self.dir / "manifest.json").write_text(json.dumps(
            {**ref, **(extra or {}), "sha256": dict(sorted(self.files.items()))}, indent=1, ensure_ascii=False) + "\n")
        return ref


def shards_sha256(files: dict[str, str]) -> str:
    """The hash of a shard set: every (name, sha256 of content), sorted by name."""
    return _sha("".join(f"{n}\t{h}\n" for n, h in sorted(files.items())).encode())


def shards_sha256_of_texts(texts: dict[str, str]) -> str:
    return shards_sha256({n: _sha(t.encode()) for n, t in texts.items()})


def check_dir(ref: dict) -> list[str]:
    """Problems with a shard directory against the `by_ref` block a run echoed (empty: intact)."""
    d = Path(ref.get("dir") or "")
    man = d / "manifest.json"
    if not man.exists():
        return [f"{d}: no manifest.json (the shard directory is gone or was never written)"]
    m = json.loads(man.read_text())
    out = []
    if m.get("shards_sha256") != ref.get("shards_sha256"):
        out.append(f"{d}: manifest shards_sha256 {m.get('shards_sha256')} ≠ the run's {ref.get('shards_sha256')}")
    for name, h in (m.get("sha256") or {}).items():
        p = d / name
        if not p.exists() or _sha(p.read_bytes()) != h:
            out.append(f"{d}/{name}: missing or changed since it was written")
    return out


def splice(prompt: str) -> str:
    """The prompt with every [[file: /abs/path]] replaced by that file's content (tests, the stub).
    READ_RULE's own "[[file: <path>]]" is not a path and stays."""
    import re
    return re.sub(r"\[\[file: (/[^\]]+)\]\]", lambda m: Path(m.group(1)).read_text(), prompt)


def report(args: dict, what: str) -> str:
    n = args_size(args)
    flag = "" if n <= COMPACT_LIMIT else f"  WARNING: above the {COMPACT_LIMIT}-byte bound for typed args"
    return f"{what}: compact args {n} bytes{flag}"
