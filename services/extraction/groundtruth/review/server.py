"""Ground-truth review tool: a local page for confirming or disputing each record against the book.

    python3 services/extraction/groundtruth/review/server.py [--port 3020] [--pdf-dir DIR ...]

Serves on 127.0.0.1 only. Every confirm/dispute is written straight back to the ground-truth JSON file,
so a review is committed like any other change. The book PDFs are not in git (docs/Source/*.pdf is
ignored); the server looks for each file in docs/Source/, then in every --pdf-dir, then in ~/Downloads.
Standard library only.
"""
import argparse
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
GT_DIR = HERE.parent
REPO = GT_DIR.parents[2]
TOKENS_CSS = REPO / "app" / "src" / "app" / "globals.css"
SKIP = {"TEMPLATE.json", "book-record.schema.json"}
SKIP_PREFIX = ("EXAMPLE",)

PDF_DIRS: list[Path] = []


def gt_files():
    out = []
    for p in sorted(GT_DIR.rglob("*.json")):
        if p.name in SKIP or p.name.startswith(SKIP_PREFIX) or "review" in p.parts:
            continue
        rel = p.relative_to(GT_DIR).as_posix()
        try:
            d = json.loads(p.read_text())
            title = f"{d['lesson'].get('syllabus_ref', '')} · {d['lesson'].get('title', '')}"
            status = d.get("review", {}).get("status", "?")
        except Exception as e:  # a broken file is listed, not hidden
            title, status = f"unreadable: {e}", "error"
        out.append({"path": rel, "title": title, "status": status})
    return out


def resolve_gt(rel: str) -> Path:
    p = (GT_DIR / rel).resolve()
    if GT_DIR not in p.parents or p.suffix != ".json" or not p.exists():
        raise FileNotFoundError(rel)
    return p


def resolve_pdf(rel: str) -> Path:
    d = json.loads(resolve_gt(rel).read_text())
    fp = d["source_document"]["file_path"]
    name = Path(fp).name
    blocked = None
    for cand in [REPO / fp, *[x / name for x in PDF_DIRS], Path.home() / "Downloads" / name]:
        try:
            with cand.open("rb"):
                return cand
        except FileNotFoundError:
            continue
        except PermissionError:  # macOS blocks ~/Downloads for processes without Files access
            blocked = cand
    if blocked:
        raise FileNotFoundError(f"{blocked} exists but macOS blocks reading it; copy it to {REPO / fp}")
    raise FileNotFoundError(f"{name} not found in docs/Source, --pdf-dir or ~/Downloads")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if not self.path.startswith("/pdf"):
            sys.stderr.write("%s\n" % (fmt % args))

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, ctype: str):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_pdf(self, path: Path):
        size = path.stat().st_size
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if m:
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = size - int(m.group(2))
            end = min(end, size - 1)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with path.open("rb") as f:
            f.seek(start)
            left = end - start + 1
            try:
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass  # PDF.js aborts the first full request once it knows ranges work

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/":
                return self.send_file(HERE / "review.html", "text/html; charset=utf-8")
            if u.path == "/tokens.css":
                return self.send_file(TOKENS_CSS, "text/css; charset=utf-8")
            if u.path == "/api/files":
                return self.send_json(gt_files())
            if u.path == "/api/file":
                return self.send_json(json.loads(resolve_gt(q["path"]).read_text()))
            if u.path == "/pdf":
                return self.send_pdf(resolve_pdf(q["path"]))
        except (FileNotFoundError, KeyError) as e:
            return self.send_json({"error": str(e)}, 404)
        self.send_json({"error": "not found"}, 404)

    def do_HEAD(self):
        self.send_response(200 if urlparse(self.path).path == "/" else 404)
        self.end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path != "/api/file":
            return self.send_json({"error": "not found"}, 404)
        try:
            p = resolve_gt(q["path"])
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if not isinstance(data, dict) or "items" not in data:
                raise ValueError("not a ground-truth file")
            tmp = p.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            os.replace(tmp, p)
            self.send_json({"ok": True})
        except (FileNotFoundError, KeyError, ValueError) as e:
            self.send_json({"error": str(e)}, 400)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=3020)
    ap.add_argument("--pdf-dir", action="append", default=[], help="extra folder to look for book PDFs in")
    a = ap.parse_args()
    PDF_DIRS.extend(Path(x).expanduser() for x in a.pdf_dir)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Ground-truth review: http://127.0.0.1:{a.port}  (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
