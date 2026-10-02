# Chapter 8 S0b: what the aligned-derivation hash rule would change (2026-09-26)

**Decision taken (orchestrator, reported to Samuel):** `runs/g10-math/maths/accepted.json` is **not**
rewritten for Chapter 8. The new hash rule (`assemble_maths.hash_forms`) applies from the next chapter.
The reason is below: none of the 9 changed strings changes the maths.

## The rule

The book names every equation image `md5(its LaTeX source)`. For an aligned derivation it hashed the
lines **without** `\begin{align*}…\end{align*}`, with every `&` written as the HTML entity `&amp;`,
and with whitespace removed. This is proven on the hash-accepted Chapter 8 images. Before this fix,
`assemble_maths.py` tried only the literal string, so an aligned transcription could be accepted by
agreement at best, never by hash. Now it tries both forms. It always **stores** the canonical form:
a real `&`, inside `align*`. No entity is ever stored.

## How it was measured

- `assemble_maths.py assemble g10-math` was re-run with the current code.
- Inputs: the same three runs (A `wf_ace9e326-ddf`, B `wf_e4887b3b-cbd`, C `wf_3467618f-f75`).
- Output went to a scratch directory. `runs/g10-math/maths/accepted.json` was byte-checked as unchanged.
- The comparison covers the 857 Chapter 8 images: 853 accepted in both, plus 4 teacher-only images that
  are not transcribed. No image was gained or lost.

## The 84 images that move to "accepted by hash" (count by route)

| Route today → with the rule | Images | Which pass found the hash-exact string |
|---|---|---|
| agreement → hash | 78 | A 70 · B 11 · C 3, across all 84 |
| third reading → hash | 6 | (included above) |
| **Total** | **84** | |

For 75 of the 84, the stored LaTeX does not change. Only the proof gets stronger: an exact hash replaces
agreement between two readings. Chapter 8 would go from 558 hash / 282 agreement / 13 third reading to
**642 / 204 / 7**. No other chapter is affected, because only Chapter 8 has been transcribed.

## The 9 LaTeX strings that would change

"Current" is what `accepted.json` holds, accepted by agreement. "Hash-proven" is pass B's reading,
whose hash is exact. For all 9, the pipeline's normal form (`assemble_maths.normalise`) and its
digits-and-letters signature are **identical** between the two strings.

| md5 | Used in | Current (agreement) | Hash-proven | Maths differs? |
|---|---|---|---|---|
| `96f8e7700ec9485fa5b0ee8cbd249ceb` | Ex8-4:18 solution (p.308) | `\frac{\text{0}+\text{3}}{\text{-5}-\text{4}}&=…\therefore p&=\frac{\text{6}}{\text{-9}}\\&=\frac{\text{-2}}{\text{3}}` | `\frac{0+3}{-5-4}&=\frac{p}{-3+5}\\…&=\frac{-2}{3}` | No: `\text{}` around digits only |
| `4450970fe9594dc25c1520da5f7cc237` | Ex8-4:20b solution (p.308) | `…\\\text{2}&=\frac{y-\text{1}}{x-(\text{-3})}\\…\text{2}x+\text{7}&=y` | `…\\2&=\frac{y-1}{x-(-3)}\\…2x+7&=y` | No: `\text{}` around digits only |
| `cb01b797d774c47e931c5819e2b2b7eb` | Ex8-6:30d solution (p.322) | `m_{BC}&=\frac{\text{3}+\text{3}}{\text{-2}+\text{6}}\\…\therefore y&=\frac{\text{3}}{\text{2}}x+c` | `m_{BC}&=\frac{3+3}{-2+6}\\…\therefore y&=\frac{3}{2}x+c` | No: `\text{}` around digits only |
| `52aa871919c3d1987d493e744621a300` | Ex8-6:32e solution (p.323) | `…&=\frac{1}{2}(3\sqrt{10})(3\sqrt{10})\\&=45` | `…\\&=\text{45}` | No: `\text{}` around the final 45 |
| `2d44d9a5899d9bb845ff072f627a5b39` | Ex8-6:37b solution (p.324) | `D&=(\frac{-2-4}{2};\frac{-2+4}{2})\\&=(-3;1)` | `D&=\left(\frac{-2-4}{2};\frac{-2+4}{2}\right)\\&=(-3;1)` | No: `\left(`/`\right)` sizing only |
| `ae8d7cb622a92ceac6ff246ffec07eda` | Ex8-6:38b solution (p.324) | `M(\frac{-3+5}{2};\frac{3+1}{2})\\\therefore M(1;2)` | `M\left(\frac{-3+5}{2};\frac{3+1}{2}\right)\\\therefore M(1;2)` | No: `\left(`/`\right)` sizing only |
| `963c24a011747fccfc55ec562a49cac0` | Ex8-6:45b solution (p.326) | `\text{4}&=-\frac{\text{2}}{\text{3}}b+\text{9}\\…\therefore b&=\text{7}\frac{\text{1}}{\text{2}}` | `4&=-\frac{2}{3}b+9\\…\therefore b&=7\frac{1}{2}` | No: `\text{}` around digits only |
| `6c395a00dfe6af44489f2dc4b56b9f59` | §8.3 body, gradient of a horizontal line (p.302) | `m=\frac{\text{change in y}}{\text{change in x}}=\frac{0}{\text{change in x}}=0` | `m=\frac{\text{change in }y}{\text{change in }x}=…=0` | No: y and x are set in maths italic instead of upright text |
| `74d9239379106d1e0f8d020c4c0d8d2e` | §8.3 body, gradient of a vertical line (p.302) | `m=\frac{\text{change in y}}{\text{change in x}}=\frac{\text{change in y}}{0}=\text{undefined}` | `m=\frac{\text{change in }y}{\text{change in }x}=…=\text{undefined}` | No: same as the row above |

In the table, `…` elides lines that are identical in both strings. The full strings are in the
scratch comparison (`maths-check2/` in the session scratchpad) and can be regenerated with the
command under "How it was measured".

**Verdict: all 9 changes are cosmetic.** None changes a number, a sign, a symbol or a relation.
Every difference is `\text{}` wrapping, `\left`/`\right` sizing, or whether a variable is set in
text or maths type. So nothing in Chapter 8 teaches differently.

## Consequences

- **S1 / G1: none.** The objectives, the anchors and the G1 verdicts read the same maths. But the
  approved S1 packet does embed the two §8.3 body strings (blocks b03211 and b03213, in lesson
  g10m8s3-2's shards), and the lesson args embed the exercise solutions: 6 of the strings are in
  g10m8s3-2 and 2 in g10m8s4-1. The ninth, Ex8-6:32e, is in no lesson, because G1 ruled it outside the
  chapter (answer 15). Rewriting them *would* change the approved packet's sha256 and the args of
  g10m8s3-2 and g10m8s4-1. That would force new runs with no change in content, which is why Chapter 8
  is kept as is.
- **S3: none.** The three-way check compares `normTex` forms, which drop `\text{}` wrappers and
  `\left`/`\right`. Three of the 9 hold the final line of a solution S3 checks (Ex8-4:18, Ex8-6:38b,
  Ex8-6:45b), and those finals compare the same with either string.
- **Students: none.** KaTeX draws `\text{2}` and `2` alike. The two body paragraphs show "y" and "x"
  upright instead of italic.
- **From Chapter 9 on**, `assemble_maths.py` accepts an aligned derivation by hash when either form
  proves it, and stores the canonical `align*` with a real `&` (tests:
  `services/extraction/tests/test_assemble_maths.py`, `services/extraction/tests/test_lesson_collect2.py`).
