/**
 * NO WORD IS GLUED TO THE ELEMENT BEFORE IT (feature 003 integration,
 * backlog #14).
 *
 * JSX drops the whitespace around a line break. So
 *
 *     <strong>{label}</strong>
 *     curriculum
 *
 * renders "Americancurriculum": the text node starts on a new line, React
 * trims the break and its indent, and the word lands flush against the
 * element. The fix is an explicit `{" "}` after the element. The review of
 * the 003 copy found one such join in the tree ("a tutor— automatically." on
 * `/pipeline`) and fixed it; this test keeps the next one out.
 *
 * THE RULE, over every `.tsx` under `src/`: a JSX text child whose first
 * non-blank character sits on a NEW line and is a letter or a digit, right
 * after an element or a `{…}` expression, is a missing space — and so is a
 * spaced dash ("— automatically"), which this copy always sets with a space
 * on both sides — unless
 *   · the element before it is a `<br />` (the break IS the separator);
 *   · the expression before it is a comment (it renders nothing);
 *   · the parent lays its children out itself (`flex`, `grid`, `gap-`,
 *     `space-x-`/`space-y-`, `block` on the child): the gap is the space.
 * Text that starts with other punctuation (". , ; : ! ? ) «") is left
 * alone: it is meant to touch. The opposite join — a word, a line break, then an
 * element — is not checked: it is how plural suffixes are written
 * (`question{n === 1 ? "" : "s"}`), and telling those apart needs a reader.
 *
 * It parses with the TypeScript compiler the build already uses, so the rule
 * reads real JSX, not a regex's guess at it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : tsxFiles(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

const LAYOUT = /\b(?:inline-)?flex\b|\bgrid\b|\bgap-|\bspace-[xy]-/;

function classNameOf(node: ts.Node): string {
  const attrs = ts.isJsxElement(node)
    ? node.openingElement.attributes
    : ts.isJsxSelfClosingElement(node)
      ? node.attributes
      : null;
  const a = attrs?.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "className"
  );
  return a?.initializer?.getText() ?? "";
}

function tagOf(node: ts.Node): string | null {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return null;
}

/** Every glued word, as "file:line: …". */
export function gluedWords(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const parentLays = ts.isJsxElement(node) && LAYOUT.test(classNameOf(node));
      const kids = node.children;
      for (let i = 1; i < kids.length; i++) {
        const text = kids[i]!;
        if (!ts.isJsxText(text)) continue;
        const raw = text.getFullText();
        if (!/^[ \t]*\n\s*[\p{L}\p{N}—–]/u.test(raw)) continue;
        const prev = kids[i - 1]!;
        if (ts.isJsxExpression(prev) && !prev.expression) continue; // a comment
        // `{" "}`, `{" · "}`: the expression already ends in the space
        if (
          ts.isJsxExpression(prev) &&
          prev.expression &&
          (ts.isStringLiteral(prev.expression) || ts.isNoSubstitutionTemplateLiteral(prev.expression)) &&
          /\s$/.test(prev.expression.text)
        )
          continue;
        if (tagOf(prev) === "br") continue;
        if (parentLays || /\bblock\b/.test(classNameOf(prev))) continue;
        const line = sf.getLineAndCharacterOfPosition(text.getStart()).line + 1;
        out.push(`${path.relative(SRC, file)}:${line}: "${prev.getText().slice(-40)}" + "${raw.trim().slice(0, 40)}"`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

test("the rule sees the bug and passes the fix", () => {
  const glued = `const A = () => (<p>\n  <strong>American</strong>\n  curriculum\n</p>);`;
  const spaced = `const A = () => (<p>\n  <strong>American</strong>{" "}\n  curriculum\n</p>);`;
  const laidOut = `const A = () => (<p className="flex gap-2">\n  <span>x</span>\n  curriculum\n</p>);`;
  const punct = `const A = () => (<p>\n  <em>tutor</em>\n  , automatically\n</p>);`;
  assert.equal(gluedWords("a.tsx", glued).length, 1);
  assert.equal(gluedWords("a.tsx", spaced).length, 0);
  assert.equal(gluedWords("a.tsx", laidOut).length, 0);
  assert.equal(gluedWords("a.tsx", punct).length, 0);
  // the join the review found on /pipeline: "a tutor— automatically."
  const dash = `const A = () => (<h1>\n  a{" "}\n  <em>\n    tutor\n  </em>\n  — automatically.\n</h1>);`;
  assert.equal(gluedWords("a.tsx", dash).length, 1);
});

test("no word in any student or console surface is glued to the element before it", () => {
  const files = tsxFiles(SRC);
  assert.ok(files.length > 100, `only ${files.length} .tsx files found under ${SRC}`);
  const hits = files.flatMap((f) => gluedWords(f, readFileSync(f, "utf8")));
  assert.deepEqual(hits, [], `add {" "} after the element:\n${hits.join("\n")}`);
});
